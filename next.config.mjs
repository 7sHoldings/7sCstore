/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdfkit", "exceljs", "@prisma/client", "bcryptjs"],
};

export default nextConfig;
