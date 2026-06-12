"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const supabase_js_1 = require("@supabase/supabase-js");
// Load environment variables from the frontend's config
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "../../kachna-frontend/.env.local") });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
    console.error("❌ Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined in frontend .env.local");
    process.exit(1);
}
console.log("Supabase URL:", supabaseUrl);
console.log("Service Key is defined:", !!supabaseServiceKey);
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
async function createAdminUser() {
    const email = "admin-studio@kachnamedia.com";
    const password = "KachnaStudio2026#";
    console.log(`🚀 Provisioning admin user: ${email}...`);
    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto confirm email
        user_metadata: {
            role: "admin"
        },
        app_metadata: {
            role: "admin" // Set app metadata role to admin
        }
    });
    if (error) {
        console.error("❌ Failed to create admin user:", error.message);
        console.error(JSON.stringify(error, null, 2));
    }
    else {
        console.log("✅ Admin user successfully created!");
        console.log("User ID:", data.user?.id);
        console.log("Email:", data.user?.email);
        console.log("App Metadata:", data.user?.app_metadata);
    }
}
createAdminUser();
