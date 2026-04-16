import { defineConfig } from "@medusajs/framework/utils"
import path from "path"

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
    
  },
admin: {
  path: "/dashboard",
},

  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: path.resolve(
  __dirname,
  "./razorpay-plugin/.medusa/server/src/providers/razorpay"
),
            id: "razorpay",
            options: {
              key_id: process.env.RAZORPAY_KEY_ID!,
              key_secret: process.env.RAZORPAY_KEY_SECRET!,
              razorpay_account: process.env.RAZORPAY_ACCOUNT,
              automatic_expiry_period: 30,
              manual_expiry_period: 20,
              refund_speed: "normal",
              webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET,
            },
          },
        ],
      },
    },
  ],
})