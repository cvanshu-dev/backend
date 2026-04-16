const { execSync } = require("child_process")
const { existsSync } = require("fs")

if (!existsSync(".medusa/client/index.html")) {
  execSync("npm run build", { stdio: "inherit" })
}

execSync("medusa start", { stdio: "inherit" })
