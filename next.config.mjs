/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep native/Node-only libs out of the bundle so they run correctly in
  // serverless functions.
  serverExternalPackages: ["pdfkit", "exceljs", "@prisma/client", "bcryptjs"],
  // pdfkit reads its .afm font-metric files from disk at runtime; force them
  // into the /api/export function bundle so PDF export works on Vercel.
  outputFileTracingIncludes: {
    "/api/export": ["./node_modules/pdfkit/js/data/*.afm"],
  },
};

export default nextConfig;
