"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("@prisma/config");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Add it to kachna-backend/.env (never commit this file).");
}
exports.default = (0, config_1.defineConfig)({
    datasource: {
        url: databaseUrl,
    },
});
