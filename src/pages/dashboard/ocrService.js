const OCR_ENDPOINT =
  process.env.REACT_APP_OCR_ENDPOINT || "http://localhost:8000/upload";

const OCR_STREAM_ENDPOINT =
  process.env.REACT_APP_OCR_STREAM_ENDPOINT ||
  OCR_ENDPOINT.replace(/\/upload$/, "/upload-stream");

const OCR_TIMEOUT_MS = 1200000;

function buildOcrResult(data = {}) {
  return {
    text: data.text || "",
    lines: data.lines ?? [],
    detectedLineCount: data.detected_line_count ?? data.detectedLineCount ?? data.lines?.length ?? 0,
    duplicateLineCount: data.duplicate_line_count ?? data.duplicateLineCount ?? 0,
    processedLineCount: data.processed_line_count ?? data.processedLineCount ?? data.lines?.length ?? 0,
    truncated: Boolean(data.truncated),
  };
}

async function extractTextFromImageJson(file, signal) {
  const formData = new FormData();

  formData.append("file", file, file.name);

  let response;

  try {
    response =
      await fetch(OCR_ENDPOINT, {
        method: "POST",
        body: formData,
        signal,
      });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "OCR is taking too long on this machine. Try a smaller/clearer image, or run the FastAPI model on a GPU server."
      );
    }

    throw new Error(
      `Could not reach the OCR server at ${OCR_ENDPOINT}. Start FastAPI with "uvicorn main:app --reload --port 8000", then try again.`
    );
  }

  if (!response.ok) {
    let message =
      "Image text extraction failed.";

    try {
      const data =
        await response.json();

      message =
        data.detail || data.error || message;
    } catch (error) {
      const text =
        await response.text();

      message =
        text || message;
    }

    throw new Error(message);
  }

  const data =
    await response.json();

  return buildOcrResult(data);
}

async function extractTextFromImageStream(file, signal, onProgress) {
  const formData = new FormData();

  formData.append("file", file, file.name);

  let response;

  try {
    response =
      await fetch(OCR_STREAM_ENDPOINT, {
        method: "POST",
        body: formData,
        signal,
      });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "OCR is taking too long on this machine. Try a smaller/clearer image, or run the FastAPI model on a GPU server."
      );
    }

    throw new Error(
      `Could not reach the OCR server at ${OCR_STREAM_ENDPOINT}. Start FastAPI with "uvicorn main:app --reload --port 8000", then try again.`
    );
  }

  if (!response.ok || !response.body) {
    if (!response.body) {
      return extractTextFromImageJson(file, signal);
    }

    let message =
      "Image text extraction failed.";

    try {
      const data =
        await response.json();

      message =
        data.detail || data.error || message;
    } catch (error) {
      const text =
        await response.text();

      message =
        text || message;
    }

    throw new Error(message);
  }

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";
  let latestResult = buildOcrResult();

  const handleEvent = (event) => {
    if (event.type === "error") {
      throw new Error(event.detail || "Image text extraction failed.");
    }

    if (event.type === "metadata") {
      latestResult = {
        ...latestResult,
        detectedLineCount: event.detected_line_count ?? 0,
        duplicateLineCount: event.duplicate_line_count ?? 0,
        processedLineCount: event.processed_line_count ?? 0,
        truncated: Boolean(event.truncated),
      };
      onProgress?.(latestResult);
      return;
    }

    if (event.type === "lines") {
      latestResult = {
        ...latestResult,
        text: event.text || "",
        lines: latestResult.lines.concat(event.lines ?? []),
        detectedLineCount: event.detected_line_count ?? latestResult.detectedLineCount,
        duplicateLineCount: event.duplicate_line_count ?? latestResult.duplicateLineCount,
        processedLineCount: event.processed_line_count ?? latestResult.processedLineCount,
        truncated: Boolean(event.truncated),
      };
      onProgress?.(latestResult);
      return;
    }

    if (event.type === "done") {
      latestResult = buildOcrResult(event);
      onProgress?.(latestResult);
    }
  };

  while (true) {
    const { done, value } =
      await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const lines =
      buffer.split("\n");

    buffer =
      lines.pop() ?? "";

    for (const line of lines) {
      const cleanLine =
        line.trim();

      if (!cleanLine) {
        continue;
      }

      handleEvent(JSON.parse(cleanLine));
    }
  }

  if (buffer.trim()) {
    handleEvent(JSON.parse(buffer.trim()));
  }

  return latestResult;
}

export async function extractTextFromImage(file, options = {}) {
  const controller = new AbortController();
  const timeoutId =
    window.setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  try {
    if (options.onProgress) {
      return await extractTextFromImageStream(
        file,
        controller.signal,
        options.onProgress
      );
    }

    return await extractTextFromImageJson(file, controller.signal);
  } finally {
    window.clearTimeout(timeoutId);
  }
}
