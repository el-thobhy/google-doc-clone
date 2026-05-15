using System.Web.Mvc;

namespace test_google_doc.Controllers
{
    public class DocumentController : Controller
    {
        // GET: /Document/Login
        public ActionResult Login()
        {
            // Jika sudah login, redirect ke editor
            if (Session["UserName"] != null)
            {
                return RedirectToAction("Editor");
            }
            return View();
        }

        // POST: /Document/Login
        [HttpPost]
        [ValidateAntiForgeryToken]
        public ActionResult Login(string userName, string documentId)
        {
            if (string.IsNullOrWhiteSpace(userName))
            {
                ViewBag.Error = "Nama tidak boleh kosong.";
                return View();
            }

            if (string.IsNullOrWhiteSpace(documentId))
            {
                documentId = "default";
            }

            Session["UserName"] = userName.Trim();
            Session["DocumentId"] = documentId.Trim();

            return RedirectToAction("Editor");
        }

        // GET: /Document/Editor
        public ActionResult Editor()
        {
            if (Session["UserName"] == null)
            {
                return RedirectToAction("Login");
            }

            ViewBag.UserName = Session["UserName"];
            ViewBag.DocumentId = Session["DocumentId"] ?? "default";
            return View();
        }

        // GET: /Document/Logout
        public ActionResult Logout()
        {
            Session.Clear();
            return RedirectToAction("Login");
        }
    }
}
