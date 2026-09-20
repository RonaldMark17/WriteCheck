export const getBackendBaseUrl = () => {
  if (process.env.REACT_APP_BACKEND_URL) {
    return process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
  }
  if (
    typeof window !== "undefined" &&
    window.location.hostname &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return window.location.origin;
  }
  return "http://localhost:8000";
};

export const getOcrEndpoint = () => {
  if (process.env.REACT_APP_OCR_ENDPOINT) {
    return process.env.REACT_APP_OCR_ENDPOINT;
  }
  return `${getBackendBaseUrl()}/upload`;
};

export const getOcrStreamEndpoint = () => {
  if (process.env.REACT_APP_OCR_STREAM_ENDPOINT) {
    return process.env.REACT_APP_OCR_STREAM_ENDPOINT;
  }
  return `${getBackendBaseUrl()}/upload-stream`;
};

export const normalizeFileUrl = (url) => {
  if (!url || typeof url !== "string") return url;

  const backendBase = getBackendBaseUrl();
  let normalized = url.replace(/^https?:\/\/(localhost|127\.0\.0\.1):8000/, backendBase);

  // If page is loaded over HTTPS, upgrade any http: to https: for writecheck.duckdns.org
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    normalized.startsWith("http://writecheck.duckdns.org")
  ) {
    normalized = normalized.replace(/^http:/, "https:");
  }

  return normalized;
};

