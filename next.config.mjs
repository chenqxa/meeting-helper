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
    // Next 16：经 proxy/中间件的请求体默认缓冲上限 10MB，超过会被截断
    // Excel 带图导入文件可达 40MB，故放宽到 100MB
    proxyClientMaxBodySize: '100mb',
  },
};

export default nextConfig;
