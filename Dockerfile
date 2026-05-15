# Stage 1: Build
FROM mcr.microsoft.com/dotnet/framework/sdk:4.8-windowsservercore-ltsc2019 AS build
WORKDIR /app

# Copy NuGet config dan packages.config dulu untuk restore
COPY packages.config .
COPY test-google-doc.csproj .
COPY test-google-doc.sln .

# Restore NuGet packages
RUN nuget restore test-google-doc.sln

# Copy seluruh source code
COPY . .

# Build project dalam mode Release
RUN msbuild test-google-doc.csproj /p:Configuration=Release /p:DeployOnBuild=true /p:PublishUrl=/publish /p:DeployDefaultTarget=WebPublish /p:WebPublishMethod=FileSystem

# Stage 2: Runtime
FROM mcr.microsoft.com/dotnet/framework/aspnet:4.8-windowsservercore-ltsc2019
WORKDIR /inetpub/wwwroot

# Copy hasil publish dari build stage
COPY --from=build /publish .

# Expose port 80 (IIS default)
EXPOSE 80
