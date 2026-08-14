/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@loja/catalog', '@loja/db'],
};

export default nextConfig;
