const { execSync } = require("child_process")
const { existsSync, readFileSync } = require("fs")
const path = require("path")
const fs = require("fs")

// Load .env file manually
const envPath = path.join(__dirname, "..", ".env")
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8")
  envContent.split("\n").forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=")
      const value = valueParts.join("=")
      if (key && value && !process.env[key]) {
        process.env[key] = value
      }
    }
  })
}

const adminIndex = ".medusa/client/index.html"
const publicAdminDir = "public/admin"
const buildEnv = { ...process.env, NPM_CONFIG_PRODUCTION: "false" }

if (!existsSync(adminIndex)) {
  console.log("Admin build missing, running build...")
  execSync("npm run build", { stdio: "inherit", env: buildEnv })
}

// Copy admin build to public/admin for production server
if (process.env.NODE_ENV === "production" && existsSync(adminIndex)) {
  console.log("Setting up admin build for production...")
  console.log("NODE_ENV:", process.env.NODE_ENV)
  console.log("REDIS_URL:", process.env.REDIS_URL ? "✓ configured" : "✗ missing")
  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "✓ configured" : "✗ missing")
  
  const sourceDir = ".medusa/server/public/admin"
  if (existsSync(sourceDir)) {
    // Create public/admin directory if it doesn't exist
    if (!existsSync(publicAdminDir)) {
      fs.mkdirSync(publicAdminDir, { recursive: true })
    }
    
    // Use recursive copy with fs
    const copyRecursive = (src, dest) => {
      if (!existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true })
      }
      const files = fs.readdirSync(src)
      files.forEach(file => {
        const srcFile = path.join(src, file)
        const destFile = path.join(dest, file)
        if (fs.statSync(srcFile).isDirectory()) {
          copyRecursive(srcFile, destFile)
        } else {
          fs.copyFileSync(srcFile, destFile)
        }
      })
    }
    
    copyRecursive(sourceDir, publicAdminDir)
    console.log("Admin build copied successfully")
  }
}

// Pass all current environment variables to medusa start
execSync("medusa start", { stdio: "inherit", env: process.env })
