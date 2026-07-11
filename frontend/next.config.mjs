/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The legacy app used plain <img> tags and remote avatar hosts (ui-avatars).
  // Keep images unoptimized so no next/image host allow-list is needed and the
  // markup stays identical to the original.
  images: { unoptimized: true },

  // Redirect the legacy static `*.html` URLs to their new routes. This keeps
  // old bookmarks working and — importantly — fixes already-installed PWAs
  // whose manifest start_url was "/login.html", so they open the new app
  // without needing a reinstall.
  async redirects() {
    const map = {
      "/home.html": "/",
      "/index.html": "/dashboard",
      "/login.html": "/login",
      "/sign.html": "/sign",
      "/section.html": "/section",
      "/attendance.html": "/attendance",
      "/class-record.html": "/class-record",
      "/performance.html": "/performance",
      "/grading-system.html": "/grading-system",
      "/facilitators.html": "/facilitators",
      "/about.html": "/about",
      "/help.html": "/help",
      "/privacy.html": "/privacy",
      "/terms.html": "/terms",
    };
    return Object.entries(map).map(([source, destination]) => ({
      source,
      destination,
      permanent: false,
    }));
  },
};

export default nextConfig;
