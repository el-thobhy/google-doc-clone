using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNet.SignalR;

namespace test_google_doc.Hubs
{
    public class DocumentHub : Hub
    {
        // Menyimpan konten dokumen per documentId (in-memory)
        private static readonly ConcurrentDictionary<string, string> DocumentContents =
            new ConcurrentDictionary<string, string>();

        // Menyimpan daftar user yang sedang online per documentId
        private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, string>> DocumentUsers =
            new ConcurrentDictionary<string, ConcurrentDictionary<string, string>>();

        /// <summary>
        /// Dipanggil saat user join ke dokumen
        /// </summary>
        public async Task JoinDocument(string documentId, string userName)
        {
            await Groups.Add(Context.ConnectionId, documentId);

            // Tambah user ke daftar online
            var users = DocumentUsers.GetOrAdd(documentId, _ => new ConcurrentDictionary<string, string>());
            users[Context.ConnectionId] = userName;

            // Kirim konten dokumen saat ini ke user yang baru join
            string currentContent = DocumentContents.GetOrAdd(documentId, "");
            Clients.Caller.ReceiveFullContent(currentContent);

            // Broadcast daftar user online ke semua di group
            Clients.Group(documentId).UpdateUserList(GetUserList(documentId));
        }

        /// <summary>
        /// Dipanggil saat user mengirim patch (diff) ke server
        /// </summary>
        public void SendPatch(string documentId, string patchText, string userName)
        {
            // Broadcast patch ke semua client lain di group (kecuali pengirim)
            Clients.OthersInGroup(documentId).ReceivePatch(patchText, userName);
        }

        /// <summary>
        /// Dipanggil saat user mengirim full content (fallback jika patch gagal)
        /// </summary>
        public void SendFullContent(string documentId, string content, string userName)
        {
            // Update server-side content
            DocumentContents[documentId] = content;

            // Broadcast ke semua client lain
            Clients.OthersInGroup(documentId).ReceiveFullContent(content);
        }

        /// <summary>
        /// Update konten di server (untuk sinkronisasi)
        /// </summary>
        public void UpdateServerContent(string documentId, string content)
        {
            DocumentContents[documentId] = content;
        }

        public override Task OnDisconnected(bool stopCalled)
        {
            // Hapus user dari semua dokumen
            foreach (var doc in DocumentUsers)
            {
                string removedUser;
                if (doc.Value.TryRemove(Context.ConnectionId, out removedUser))
                {
                    // Broadcast updated user list
                    Clients.Group(doc.Key).UpdateUserList(GetUserList(doc.Key));
                }
            }

            return base.OnDisconnected(stopCalled);
        }

        private List<string> GetUserList(string documentId)
        {
            var list = new List<string>();
            ConcurrentDictionary<string, string> users;
            if (DocumentUsers.TryGetValue(documentId, out users))
            {
                foreach (var kvp in users)
                {
                    list.Add(kvp.Value);
                }
            }
            return list;
        }
    }
}
