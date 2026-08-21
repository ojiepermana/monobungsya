module.exports = {
  "/health": {
    target: "http://localhost:3000",
    secure: false,
    changeOrigin: true,
  },
  "/api": {
    target: "http://localhost:3000",
    secure: false,
    changeOrigin: true,
  },
};
