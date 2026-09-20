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
