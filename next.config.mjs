/** @type {import('next').NextConfig} */
const nextConfig = {
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),  // Uncomment and add 'import path from "path"' if needed
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'your-cdn-domain.com', // 限制为具体的域名，不使用通配符
        pathname: '/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'static.example.com',
        pathname: '/images/**',
      },
      // 如果需要支持多个域名，请逐一添加
    ],
  },
  serverExternalPackages: ['pdfkit'],
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
