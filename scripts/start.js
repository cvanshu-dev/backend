const { execSync } = require("child_process")
const { existsSync } = require("fs")

const adminIndex = ".medusa/client/index.html"
const env = { ...process.env, NPM_CONFIG_PRODUCTION: "false" }

if (!existsSync(adminIndex)) {
  console.log("Admin build missing, running build...")
  execSync("npm run build", { stdio: "inherit", env })
}

execSync("medusa start", { stdio: "inherit" })
