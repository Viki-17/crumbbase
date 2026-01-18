import axios from "axios";

// Create a centralized Axios instance
// In Vite dev, '/api' is proxied to localhost:3001
// In Production, it will be relative to the domain (e.g. web.chatcrumbs.com/api)
const api = axios.create({
  baseURL: "/api",
});

export default api;
