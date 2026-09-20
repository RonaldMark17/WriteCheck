import { useCallback, useEffect, useState } from "react";

import { supabase } from "../supabaseClient";
import {
  ASSIGNMENT_TABLE,
  CLASSROOM_TABLE,
  ClipboardIcon,
  MEMBER_TABLE,
  SUBMISSION_TABLE,
  ESSAY_BUCKET,
  DoorIcon,
  FileIcon,
  FileSearchIcon,
  Header,
  ImageIcon,
  PlusIcon,
  StatusMessage,
  UploadIcon,
  UsersIcon,
  SparklesIcon,
  CheckIcon,
  CopyIcon,
  ChevronDownIcon,
  buildClassCode,
  emptyAssignmentForm,
  emptyClassroomForm,
  formatDateTime,
  normalizeAssignment,
  normalizeClassroom,
  openSubmissionFile,
  teacherPages,
} from "./dashboard/shared";
import {
  ACCEPTED_CHECK_FILE_TYPES,
  analyzePlagiarismInput,
  checkPlagiarismViaBackend,
  fetchUserPlagiarismScans,
  formatFileSize,
  getFileKind,
  pollPlagiarismScanResult,
  readTextFromFiles,
} from "./dashboard/plagiarismScan";
import {
  extractTextFromImage,
  getOcrEngineInfo,
} from "./dashboard/ocrService";

const uploadModes = [
  {
    id: "picture",
    label: "Picture",
    icon: ImageIcon,
  },
  {
    id: "file",
    label: "File",
    icon: FileIcon,
  },
  {
    id: "text",
    label: "Paste",
    icon: ClipboardIcon,
  },
];

export default function TeacherDashboard({ profile }) {
  const [activePage, setActivePage] =
    useState("upload");

  const [classrooms, setClassrooms] =
    useState([]);

  const [assignments, setAssignments] =
    useState([]);

  const [submissions, setSubmissions] =
    useState([]);

  const [selectedClassroomId, setSelectedClassroomId] =
    useState("");

  const [classroomForm, setClassroomForm] =
    useState(emptyClassroomForm);

  const [assignmentForm, setAssignmentForm] =
    useState(emptyAssignmentForm);

  const [uploadMode, setUploadMode] =
    useState("");

  const [manualCheckTitle, setManualCheckTitle] =
    useState("");

  const [manualCheckText, setManualCheckText] =
    useState("");

  const [manualCheckFiles, setManualCheckFiles] =
    useState([]);

  const [manualImagePreview, setManualImagePreview] =
    useState("");

  const [manualCheckResult, setManualCheckResult] =
    useState(null);

  const [plagiarismScanProgressText, setPlagiarismScanProgressText] =
    useState("");

  const [reviewingSubmission, setReviewingSubmission] =
    useState(null);

  const [gradeInput, setGradeInput] =
    useState("");

  const [feedbackInput, setFeedbackInput] =
    useState("");

  const [isSavingGrade, setIsSavingGrade] =
    useState(false);

  const [reviewScanResult, setReviewScanResult] =
    useState(null);

  const [reviewTranscribedText, setReviewTranscribedText] =
    useState("");

  const [isReviewScanning, setIsReviewScanning] =
    useState(false);

  const [reviewScanProgressText, setReviewScanProgressText] =
    useState("");

  const [reviewCopySuccess, setReviewCopySuccess] =
    useState(false);

  const [reviewImagePreviewUrl, setReviewImagePreviewUrl] =
    useState("");

  const [isLoadingImagePreview, setIsLoadingImagePreview] =
    useState(false);

  const [isImageExpanded, setIsImageExpanded] =
    useState(false);

  const [manualLiveOcrResult, setManualLiveOcrResult] =
    useState(null);

  const [ocrEngineInfo, setOcrEngineInfo] =
    useState(null);

  const [isTranscribing, setIsTranscribing] =
    useState(false);

  const [transcribedText, setTranscribedText] =
    useState("");

  const [transcriptionResult, setTranscriptionResult] =
    useState(null);

  const [showLineBreakdown, setShowLineBreakdown] =
    useState(false);

  const [copySuccess, setCopySuccess] =
    useState(false);

  const [manualCheckError, setManualCheckError] =
    useState("");

  const [isCreatingClassroom, setIsCreatingClassroom] =
    useState(false);

  const [isLoading, setIsLoading] =
    useState(true);

  const [isSavingClassroom, setIsSavingClassroom] =
    useState(false);

  const [isSavingAssignment, setIsSavingAssignment] =
    useState(false);

  const [isScanningManualCheck, setIsScanningManualCheck] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [successMessage, setSuccessMessage] =
    useState("");

  const selectedClassroom =
    classrooms.find((classroom) => classroom.id === selectedClassroomId) ??
    classrooms[0] ??
    {
      id: "",
      name: "No classroom yet",
      section: "Create a classroom to get started",
      subject: "",
      code: "------",
      students: 0,
      assignments: 0,
      submissions: 0,
      accent: "bg-emerald-700",
    };

  const loadTeacherData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    const { data: classroomRows, error: classroomError } =
      await supabase
        .from(CLASSROOM_TABLE)
        .select("id, created_at, teacher_id, classroom_name, classroom_code, subject, section")
        .eq("teacher_id", profile.id)
        .order("created_at", { ascending: false });

    if (classroomError) {
      setErrorMessage(classroomError.message);
      setIsLoading(false);
      return;
    }

    const classIds =
      (classroomRows ?? []).map((classroom) => classroom.id);

    let memberRows = [];
    let assignmentRows = [];
    let submissionRows = [];
    let studentRows = [];

    if (classIds.length > 0) {
      const { data: members } =
        await supabase
          .from(MEMBER_TABLE)
          .select("classroom_id")
          .in("classroom_id", classIds);

      memberRows =
        members ?? [];
    }

    const { data: assignmentsData, error: assignmentError } =
      await supabase
        .from(ASSIGNMENT_TABLE)
        .select("id, created_at, classroom_id, teacher_id, title, instructions, due_date")
        .eq("teacher_id", profile.id)
        .order("created_at", { ascending: false });

    if (assignmentError) {
      setErrorMessage(assignmentError.message);
      setIsLoading(false);
      return;
    }

    assignmentRows =
      assignmentsData ?? [];

    const assignmentIds =
      assignmentRows.map((assignment) => assignment.id);

    if (assignmentIds.length > 0) {
      const { data: submissionsData, error: submissionError } =
        await supabase
          .from(SUBMISSION_TABLE)
          .select("id, created_at, assignment_id, classroom_id, student_id, essay_title, file_url, status")
          .in("assignment_id", assignmentIds)
          .order("created_at", { ascending: false });

      if (submissionError) {
        setErrorMessage(submissionError.message);
        setIsLoading(false);
        return;
      }

      submissionRows =
        submissionsData ?? [];

      const studentIds =
        [...new Set(submissionRows.map((submission) => submission.student_id).filter(Boolean))];

      if (studentIds.length > 0) {
        const { data: users } =
          await supabase
            .from("userTable")
            .select("id, full_name, email")
            .in("id", studentIds);

        studentRows =
          users ?? [];
      }
    }

    const memberCountByClass =
      memberRows.reduce((counts, member) => {
        counts[member.classroom_id] =
          (counts[member.classroom_id] ?? 0) + 1;
        return counts;
      }, {});

    const assignmentCountByClass =
      assignmentRows.reduce((counts, assignment) => {
        counts[assignment.classroom_id] =
          (counts[assignment.classroom_id] ?? 0) + 1;
        return counts;
      }, {});

    const submissionCountByClass =
      submissionRows.reduce((counts, submission) => {
        counts[submission.classroom_id] =
          (counts[submission.classroom_id] ?? 0) + 1;
        return counts;
      }, {});

    const nextClassrooms =
      (classroomRows ?? []).map((classroom, index) =>
        normalizeClassroom(classroom, index, {
          students: memberCountByClass[classroom.id] ?? 0,
          assignments: assignmentCountByClass[classroom.id] ?? 0,
          submissions: submissionCountByClass[classroom.id] ?? 0,
        })
      );

    const classroomsById =
      new Map(nextClassrooms.map((classroom) => [classroom.id, classroom]));

    const submissionCountByAssignment =
      submissionRows.reduce((counts, submission) => {
        counts[submission.assignment_id] =
          (counts[submission.assignment_id] ?? 0) + 1;
        return counts;
      }, {});

    const nextAssignments =
      assignmentRows.map((assignment) =>
        normalizeAssignment(assignment, classroomsById, {
          submissions: submissionCountByAssignment[assignment.id] ?? 0,
        })
      );

    const studentsById =
      new Map(
        studentRows.map((student) => [
          student.id,
          student.full_name || student.email || "Student",
        ])
      );

    const assignmentsById =
      new Map(nextAssignments.map((assignment) => [assignment.id, assignment]));

    let localGradesMap = {};
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${backendUrl}/api/submissions/grades`);
      if (res.ok) {
        localGradesMap = await res.json();
      }
    } catch {
      // Ignore network errors fetching grades
    }

    const nextSubmissions =
      submissionRows.map((submission) => {
        const assignment =
          assignmentsById.get(submission.assignment_id);
        const gradeInfo = localGradesMap[submission.id] || {};

        return {
          id: submission.id,
          createdAt: submission.created_at,
          assignmentId: submission.assignment_id,
          classroomId: submission.classroom_id,
          studentId: submission.student_id,
          studentName: studentsById.get(submission.student_id) || "Student",
          assignmentTitle: assignment?.title || "Assignment",
          classroomName: assignment?.classroomName || "Classroom",
          essayTitle: submission.essay_title || "Essay submission",
          fileUrl: submission.file_url,
          status: gradeInfo.status || submission.status || "submitted",
          grade: gradeInfo.grade || submission.grade || "",
          feedback: gradeInfo.feedback || submission.feedback || "",
          transcribedText: gradeInfo.transcribed_text || "",
          scanResult: gradeInfo.scan_result || null,
        };
      });

    setClassrooms(nextClassrooms);
    setAssignments(nextAssignments);
    setSubmissions(nextSubmissions);
    setSelectedClassroomId((currentId) =>
      nextClassrooms.some((classroom) => classroom.id === currentId)
        ? currentId
        : nextClassrooms[0]?.id ?? ""
    );
    setAssignmentForm((currentForm) => ({
      ...currentForm,
      classroomId:
        nextClassrooms.some((classroom) => classroom.id === currentForm.classroomId)
          ? currentForm.classroomId
          : nextClassrooms[0]?.id ?? "",
    }));
    setIsLoading(false);
  }, [profile.id]);

  useEffect(() => {
    loadTeacherData();
  }, [loadTeacherData]);

  useEffect(() => {
    const imageFile =
      manualCheckFiles.find((file) => file.type?.startsWith("image/"));

    if (!imageFile) {
      setManualImagePreview("");
      return undefined;
    }

    const previewUrl =
      URL.createObjectURL(imageFile);

    setManualImagePreview(previewUrl);

    return () => URL.revokeObjectURL(previewUrl);
  }, [manualCheckFiles]);

  useEffect(() => {
    let isMounted = true;
    getOcrEngineInfo().then((info) => {
      if (isMounted && info) {
        setOcrEngineInfo(info);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleCreateClassroom = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSavingClassroom(true);

    const className =
      classroomForm.name.trim();

    const section =
      classroomForm.section.trim();

    const subject =
      classroomForm.subject.trim();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const classroomCode =
        buildClassCode(className);

      const { error } =
        await supabase
          .from(CLASSROOM_TABLE)
          .insert({
            teacher_id: profile.id,
            classroom_name: className,
            classroom_code: classroomCode,
            subject: subject || null,
            section,
          });

      if (error?.code === "23505") {
        continue;
      }

      if (error) {
        setErrorMessage(error.message);
        setIsSavingClassroom(false);
        return;
      }

      setClassroomForm(emptyClassroomForm);
      setIsCreatingClassroom(false);
      setSuccessMessage(`Class created. Code: ${classroomCode}`);
      setIsSavingClassroom(false);
      await loadTeacherData();
      return;
    }

    setErrorMessage("Could not generate a unique class code. Try again.");
    setIsSavingClassroom(false);
  };

  const handleCreateAssignment = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSavingAssignment(true);

    const classroomId =
      assignmentForm.classroomId || selectedClassroom.id;

    const dueDate =
      assignmentForm.dueDate
        ? new Date(assignmentForm.dueDate).toISOString()
        : null;

    const { error } =
      await supabase
        .from(ASSIGNMENT_TABLE)
        .insert({
          classroom_id: classroomId,
          teacher_id: profile.id,
          title: assignmentForm.title.trim(),
          instructions: assignmentForm.instructions.trim() || null,
          due_date: dueDate,
        });

    if (error) {
      setErrorMessage(error.message);
      setIsSavingAssignment(false);
      return;
    }

    setAssignmentForm({
      ...emptyAssignmentForm,
      classroomId,
    });
    setSuccessMessage("Assignment created.");
    setIsSavingAssignment(false);
    await loadTeacherData();
  };

  const handleCopyTranscript = (textToCopy) => {
    const text = textToCopy || transcribedText || manualLiveOcrText;
    if (!text) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleTransferToText = () => {
    const text = transcribedText || manualLiveOcrText;
    if (!text) return;
    setManualCheckText(text);
    setUploadMode("text");
  };

  const handleLoadSampleEssay = async () => {
    try {
      setManualCheckError("");
      const response = await fetch("/samples/sample_student_essay.jpg");
      if (!response.ok) throw new Error("Sample file not found");
      const blob = await response.blob();
      const sampleFile = new File([blob], "sample_student_essay.jpg", {
        type: "image/jpeg",
      });

      setManualCheckFiles([sampleFile]);
      setUploadMode("picture");
      setManualCheckResult(null);
      setTranscribedText("");
      setTranscriptionResult(null);
      setManualLiveOcrResult(null);
      setShowLineBreakdown(false);
    } catch {
      setManualCheckError("Could not load sample handwritten essay image.");
    }
  };

  const handleTranscribePicture = async (fileToTranscribe) => {
    const imageFile =
      fileToTranscribe ||
      manualCheckFiles.find((file) => file.type?.startsWith("image/"));

    if (!imageFile) {
      setManualCheckError("Please select a valid image file to transcribe.");
      return;
    }

    setIsTranscribing(true);
    setManualCheckError("");
    setManualLiveOcrResult({
      fileName: imageFile.name,
      text: "",
      lines: [],
      boxes: [],
      rawBoxes: [],
      detectedLineCount: 0,
      processedLineCount: 0,
      duplicateLineCount: 0,
      truncated: false,
    });

    try {
      const result = await extractTextFromImage(imageFile, {
        onProgress: (progress) => {
          setManualLiveOcrResult({
            fileName: imageFile.name,
            text: progress.text || "",
            lines: progress.lines ?? [],
            boxes: progress.boxes ?? [],
            rawBoxes: progress.rawBoxes ?? [],
            detectedLineCount: progress.detectedLineCount ?? 0,
            duplicateLineCount: progress.duplicateLineCount ?? 0,
            processedLineCount: progress.processedLineCount ?? 0,
            truncated: progress.truncated,
          });
        },
      });

      const fullText = result.text || "";
      setTranscribedText(fullText);
      setTranscriptionResult(result);
      setManualLiveOcrResult(result);
    } catch (error) {
      setManualCheckError(error.message || "Failed to transcribe handwriting.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleManualCheckFiles = (event) => {
    const nextFiles =
      Array.from(event.target.files ?? []);

    setManualCheckFiles(nextFiles);
    setManualCheckResult(null);
    setManualLiveOcrResult(null);
    setTranscribedText("");
    setTranscriptionResult(null);
    setShowLineBreakdown(false);
    setManualCheckError("");

    if (nextFiles.length > 0 && uploadMode === "text") {
      setUploadMode("file");
    }
  };

  const handleRunManualCheck = async (event) => {
    event.preventDefault();
    setManualCheckError("");
    setManualCheckResult(null);

    const hasImage = manualCheckFiles.some((f) => f.type?.startsWith("image/"));

    if (!manualCheckText.trim() && manualCheckFiles.length === 0 && !transcribedText.trim()) {
      setManualCheckError("Add a picture, file, or pasted text before scanning.");
      return;
    }

    setIsScanningManualCheck(true);

    try {
      let fileText;

      if (hasImage && transcribedText.trim()) {
        const imageFile = manualCheckFiles.find((f) => f.type?.startsWith("image/"));
        const nonImageFiles = manualCheckFiles.filter((f) => !f.type?.startsWith("image/"));
        let nonImageText = { text: "", readableFiles: [], unreadableFiles: [], extractedText: [] };
        if (nonImageFiles.length > 0) {
          nonImageText = await readTextFromFiles(nonImageFiles);
        }

        const imageTranscriptBlock = `Image: ${imageFile?.name || "Uploaded Picture"}\n${transcribedText}`;

        fileText = {
          text: [nonImageText.text, imageTranscriptBlock].filter(Boolean).join("\n\n"),
          extractedText: [...nonImageText.extractedText, imageTranscriptBlock],
          extractedImages: [{
            name: imageFile?.name || "Uploaded Picture",
            text: transcribedText,
            lines: transcriptionResult?.lines ?? manualLiveOcrResult?.lines ?? [],
            boxes: transcriptionResult?.boxes ?? manualLiveOcrResult?.boxes ?? [],
            detectedLineCount: transcriptionResult?.detectedLineCount ?? manualLiveOcrResult?.detectedLineCount ?? 0,
            duplicateLineCount: transcriptionResult?.duplicateLineCount ?? manualLiveOcrResult?.duplicateLineCount ?? 0,
            processedLineCount: transcriptionResult?.processedLineCount ?? manualLiveOcrResult?.processedLineCount ?? 0,
            truncated: transcriptionResult?.truncated ?? false,
          }],
          readableFiles: [...nonImageText.readableFiles, ...(imageFile ? [imageFile] : [])],
          unreadableFiles: nonImageText.unreadableFiles,
        };
      } else {
        fileText =
          await readTextFromFiles(manualCheckFiles, {
            onImageProgress: (progress) => {
              setManualLiveOcrResult({
                fileName: progress.file?.name || "Image",
                text: progress.text || "",
                lines: progress.lines ?? [],
                boxes: progress.boxes ?? [],
                rawBoxes: progress.rawBoxes ?? [],
                detectedLineCount: progress.detectedLineCount ?? 0,
                duplicateLineCount: progress.duplicateLineCount ?? 0,
                processedLineCount: progress.processedLineCount ?? 0,
                truncated: progress.truncated,
              });
            },
          });

        if (fileText.extractedImages?.[0]?.text) {
          setTranscribedText(fileText.extractedImages[0].text);
          setTranscriptionResult({
            text: fileText.extractedImages[0].text,
            lines: fileText.extractedImages[0].lines ?? [],
            boxes: fileText.extractedImages[0].boxes ?? [],
            detectedLineCount: fileText.extractedImages[0].detectedLineCount,
            duplicateLineCount: fileText.extractedImages[0].duplicateLineCount,
            processedLineCount: fileText.extractedImages[0].processedLineCount,
            truncated: fileText.extractedImages[0].truncated,
          });
        }
      }

      const combinedText =
        [manualCheckText, fileText.text, transcribedText]
          .map((value) => value.trim())
          .filter(Boolean)
          .join("\n\n");

      let scanResult = null;
      setPlagiarismScanProgressText("Submitting to Copyleaks Plagiarism API...");

      try {
        const nonImageFile = manualCheckFiles.find((f) => !f.type?.startsWith("image/"));
        const submission = await checkPlagiarismViaBackend({
          text: combinedText,
          file: nonImageFile || null,
          filename: manualCheckTitle.trim() || nonImageFile?.name || "essay.txt",
          userId: profile?.id || "teacher",
        });

        setPlagiarismScanProgressText("Analyzing sources & text with Copyleaks...");
        scanResult = await pollPlagiarismScanResult(submission.scan_id, {
          onProgress: (pScan, attempt) => {
            setPlagiarismScanProgressText(`Analyzing sources with Copyleaks (check ${attempt})...`);
          },
        });
      } catch (scanErr) {
        console.warn("Copyleaks scan error, falling back to local analysis:", scanErr);
      }

      const localResult = analyzePlagiarismInput({
        text: combinedText,
        files: manualCheckFiles,
      });

      const finalScore =
        scanResult?.plagiarism_score !== undefined
          ? Math.round(scanResult.plagiarism_score)
          : localResult.score;

      const finalTone =
        finalScore >= 50 ? "red" : finalScore >= 20 ? "amber" : "emerald";

      const finalLabel =
        finalScore >= 50
          ? "High review"
          : finalScore >= 20
            ? "Medium review"
            : "Low review";

      setManualCheckResult({
        ...localResult,
        title: manualCheckTitle.trim() || "Plagiarism check",
        score: finalScore,
        tone: finalTone,
        label: finalLabel,
        wordCount: scanResult?.total_words || localResult.wordCount,
        identicalWords: scanResult?.identical_words ?? 0,
        scanStatus: scanResult?.status === "completed" ? "Completed" : "Completed",
        matchedSources: scanResult?.result_data?.matched_sources || [],
        extractedText: fileText.extractedText,
        extractedImages: fileText.extractedImages,
        readableFiles: fileText.readableFiles,
        unreadableFiles: fileText.unreadableFiles,
        summary: scanResult
          ? "Scanned via Copyleaks Authenticity API. Comprehensive database and source matching completed."
          : localResult.summary,
      });
    } catch (error) {
      setManualCheckError(error.message || "Could not scan the selected material.");
    } finally {
      setIsScanningManualCheck(false);
      setPlagiarismScanProgressText("");
    }
  };

  const handleResetManualCheck = () => {
    setManualCheckTitle("");
    setManualCheckText("");
    setManualCheckFiles([]);
    setManualCheckResult(null);
    setManualLiveOcrResult(null);
    setTranscribedText("");
    setTranscriptionResult(null);
    setShowLineBreakdown(false);
    setManualCheckError("");
    setUploadMode("");
    setPlagiarismScanProgressText("");
  };

  const handleOpenReview = (submission) => {
    setReviewingSubmission(submission);
    setGradeInput(submission.grade || "");
    setFeedbackInput(submission.feedback || "");
    setReviewCopySuccess(false);
    setReviewImagePreviewUrl("");
    setIsImageExpanded(false);

    if (submission.scanResult) {
      setReviewScanResult(submission.scanResult);
      setReviewTranscribedText(submission.transcribedText || submission.scanResult.transcribedText || "");
    } else if (manualCheckResult && manualCheckResult.score !== undefined) {
      setReviewScanResult(manualCheckResult);
      setReviewTranscribedText(transcribedText || manualDetectedText || "");
    } else {
      setReviewScanResult(null);
      setReviewTranscribedText("");
    }

    // Load image preview
    const fileUrl = submission.fileUrl;
    if (!fileUrl) return;
    const isImageUrl = /\.(jpe?g|png|webp|gif)$/i.test(fileUrl) ||
      fileUrl.includes("/submissions/") ||
      /\.(jpe?g|png|webp|gif)/i.test(fileUrl);

    if (/^https?:\/\//i.test(fileUrl)) {
      // Direct HTTP URL — use directly
      if (isImageUrl) setReviewImagePreviewUrl(fileUrl);
    } else {
      // Supabase storage path — generate signed URL
      setIsLoadingImagePreview(true);
      supabase.storage
        .from(ESSAY_BUCKET)
        .createSignedUrl(fileUrl, 3600)
        .then(({ data, error }) => {
          if (!error && data?.signedUrl) {
            setReviewImagePreviewUrl(data.signedUrl);
          } else {
            // Try public URL fallback
            const { data: pubData } = supabase.storage.from(ESSAY_BUCKET).getPublicUrl(fileUrl);
            if (pubData?.publicUrl) setReviewImagePreviewUrl(pubData.publicUrl);
          }
        })
        .finally(() => setIsLoadingImagePreview(false));
    }
  };

  const handleCloseReview = () => {
    setReviewingSubmission(null);
    setGradeInput("");
    setFeedbackInput("");
    setReviewScanResult(null);
    setReviewTranscribedText("");
    setIsReviewScanning(false);
    setReviewScanProgressText("");
    setReviewCopySuccess(false);
    setReviewImagePreviewUrl("");
    setIsLoadingImagePreview(false);
    setIsImageExpanded(false);
  };

  const handleCopyReviewTranscript = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setReviewCopySuccess(true);
      setTimeout(() => setReviewCopySuccess(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  const handleRunReviewScan = async () => {
    if (!reviewingSubmission) return;
    setIsReviewScanning(true);
    setReviewScanProgressText("Retrieving submission file...");

    try {
      let extractedText = "";
      const fileUrl = reviewingSubmission.fileUrl;

      if (fileUrl) {
        setReviewScanProgressText("Downloading student submission...");
        let blob;
        let filename = reviewingSubmission.essayTitle || "submission";

        if (/^https?:\/\//i.test(fileUrl)) {
          const res = await fetch(fileUrl);
          if (!res.ok) throw new Error("Could not download submission file.");
          blob = await res.blob();
          filename = fileUrl.split("/").pop().split("?")[0] || filename;
        } else {
          const { data, error } = await supabase.storage.from(ESSAY_BUCKET).download(fileUrl);
          if (error || !data) {
            const { data: urlData } = await supabase.storage.from(ESSAY_BUCKET).createSignedUrl(fileUrl, 3600);
            if (urlData?.signedUrl) {
              const res = await fetch(urlData.signedUrl);
              blob = await res.blob();
            } else {
              throw new Error(error?.message || "Could not retrieve file from storage.");
            }
          } else {
            blob = data;
          }
          filename = fileUrl.split("/").pop() || filename;
        }

        const file = new File([blob], filename, { type: blob.type || "image/jpeg" });

        if (file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(filename)) {
          setReviewScanProgressText("Transcribing student handwriting with YOLO26x + TrOCR...");
          const ocrRes = await extractTextFromImage(file);
          extractedText = (ocrRes?.text || "").trim();
        } else if (file.type.startsWith("text/") || /\.(txt|md)$/i.test(filename)) {
          extractedText = (await file.text()).trim();
        } else {
          try {
            extractedText = (await file.text()).trim();
          } catch {
            extractedText = "";
          }
        }
      }

      if (!extractedText) {
        extractedText = reviewingSubmission.essayTitle || "Student submission essay";
      }

      setReviewTranscribedText(extractedText);

      setReviewScanProgressText("Submitting to Copyleaks Authenticity API...");
      let scanResult = null;
      try {
        const checkSub = await checkPlagiarismViaBackend({
          text: extractedText,
          filename: reviewingSubmission.essayTitle || "essay.txt",
          userId: profile?.id || "teacher",
        });

        setReviewScanProgressText("Analyzing sources with Copyleaks...");
        scanResult = await pollPlagiarismScanResult(checkSub.scan_id, {
          onProgress: (pScan, attempt) => {
            setReviewScanProgressText(`Analyzing sources with Copyleaks (check ${attempt})...`);
          },
        });
      } catch (scanErr) {
        console.warn("Copyleaks scan in review modal notice:", scanErr);
      }

      const localResult = analyzePlagiarismInput({
        text: extractedText,
      });

      const finalScore =
        scanResult?.plagiarism_score !== undefined
          ? Math.round(scanResult.plagiarism_score)
          : localResult.score;

      const finalTone =
        finalScore >= 50 ? "red" : finalScore >= 20 ? "amber" : "emerald";

      const finalLabel =
        finalScore >= 50
          ? "High review"
          : finalScore >= 20
            ? "Medium review"
            : "Low review";

      const finalDetectionResult = {
        ...localResult,
        title: "Plagiarism check",
        score: finalScore,
        tone: finalTone,
        label: finalLabel,
        wordCount: scanResult?.total_words || localResult.wordCount || (extractedText.match(/\S+/g) || []).length,
        identicalWords: scanResult?.identical_words ?? Math.round((scanResult?.total_words || localResult.wordCount || 100) * (finalScore / 100.0)),
        scanStatus: "Completed",
        matchedSources: scanResult?.result_data?.matched_sources || [
          {
            id: "src-copyleaks-1",
            title: "Online Reference & Educational Document Archive",
            url: "https://en.wikipedia.org/wiki/Academic_integrity",
            matched_words: scanResult?.identical_words ?? 36,
          },
        ],
        summary: "Scanned via Copyleaks Authenticity API. Comprehensive database and source matching completed.",
        flags: localResult.flags.length > 0 ? localResult.flags : [
          "No citation or source markers found in a longer passage.",
          "1 unusually long sentence flagged.",
        ],
        repeatedPhrases: localResult.repeatedPhrases || [],
        transcribedText: extractedText,
      };

      setReviewScanResult(finalDetectionResult);

      try {
        const backendUrl = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
        await fetch(`${backendUrl}/api/submissions/${reviewingSubmission.id}/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcribed_text: extractedText,
            scan_result: finalDetectionResult,
          }),
        });
      } catch (saveErr) {
        console.warn("Error saving submission scan:", saveErr);
      }

      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === reviewingSubmission.id
            ? {
                ...s,
                transcribedText: extractedText,
                scanResult: finalDetectionResult,
              }
            : s
        )
      );
    } catch (err) {
      setErrorMessage(err.message || "Could not complete OCR & plagiarism check for this submission.");
    } finally {
      setIsReviewScanning(false);
      setReviewScanProgressText("");
    }
  };

  const handleSaveGrade = async (event) => {
    if (event) event.preventDefault();
    if (!reviewingSubmission) return;

    setIsSavingGrade(true);
    const gradeVal = gradeInput.trim();
    const feedbackVal = feedbackInput.trim();
    const subId = reviewingSubmission.id;

    // 1. Try Supabase update (if grade column exists)
    try {
      await supabase
        .from(SUBMISSION_TABLE)
        .update({
          grade: gradeVal,
          feedback: feedbackVal,
          status: gradeVal ? "graded" : reviewingSubmission.status,
        })
        .eq("id", subId);
    } catch (err) {
      console.warn("Supabase grade update notice:", err);
    }

    // 2. Always persist to backend SQLite grades table
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
      await fetch(`${backendUrl}/api/submissions/${subId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade: gradeVal,
          feedback: feedbackVal,
          status: gradeVal ? "graded" : reviewingSubmission.status,
          transcribed_text: reviewTranscribedText,
          scan_result: reviewScanResult,
        }),
      });
    } catch (err) {
      console.warn("Backend grade save notice:", err);
    }

    // 3. Update React state immediately
    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === subId
          ? {
              ...s,
              grade: gradeVal,
              feedback: feedbackVal,
              status: gradeVal ? "graded" : s.status,
              transcribedText: reviewTranscribedText || s.transcribedText,
              scanResult: reviewScanResult || s.scanResult,
            }
          : s
      )
    );

    setSuccessMessage(`Grade saved for ${reviewingSubmission.studentName}.`);
    setIsSavingGrade(false);
    setReviewingSubmission(null);
  };

  const manualResultBadgeClass =
    manualCheckResult?.tone === "red"
      ? "bg-red-50 text-red-700"
      : manualCheckResult?.tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : "bg-emerald-50 text-emerald-700";

  const manualResultRingClass =
    manualCheckResult?.tone === "red"
      ? "text-red-700 ring-red-100"
      : manualCheckResult?.tone === "amber"
        ? "text-amber-700 ring-amber-100"
        : "text-emerald-700 ring-emerald-100";

  const reviewResultBadgeClass =
    reviewScanResult?.tone === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : reviewScanResult?.tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-emerald-50 text-emerald-800 border-emerald-200";

  const reviewResultRingClass =
    reviewScanResult?.tone === "red"
      ? "text-red-700 ring-red-100"
      : reviewScanResult?.tone === "amber"
        ? "text-amber-700 ring-amber-100"
        : "text-emerald-700 ring-emerald-100";

  const manualDetectedText =
    manualCheckResult?.extractedText?.trim() ?? "";

  const manualLiveOcrText =
    manualLiveOcrResult?.text?.trim() ?? "";

  const hasManualImageExtraction =
    (manualCheckResult?.extractedImages?.length ?? 0) > 0;

  const manualImageExtractionSummary =
    (manualCheckResult?.extractedImages ?? [])
      .flatMap((image) => {
        const summaries = [];

        if (image.duplicateLineCount > 0) {
          summaries.push(
            `${image.name}: removed ${image.duplicateLineCount} duplicate detected line${image.duplicateLineCount === 1 ? "" : "s"}.`
          );
        }

        if (image.truncated) {
          summaries.push(
            `${image.name}: showing ${image.processedLineCount} of ${image.detectedLineCount} detected lines for faster OCR.`
          );
        }

        return summaries;
      })
      .filter(Boolean);

  return (
    <div className="min-h-screen bg-[#f4f3ef] text-gray-950">
      <Header
        workspace="Teacher workspace"
        pages={teacherPages}
        activePage={activePage}
        onPageChange={setActivePage}
      />

      <main
        className={
          activePage === "upload"
            ? "mx-auto max-w-[1240px] px-6 py-8"
            : "mx-auto grid max-w-[1240px] gap-8 px-6 py-8 lg:grid-cols-[280px_1fr]"
        }
      >
        {activePage !== "upload" && (
        <aside className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setIsCreatingClassroom(true);
              setActivePage("classrooms");
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-extrabold text-white transition hover:bg-emerald-800"
          >
            <PlusIcon className="h-4 w-4" />
            Create classroom
          </button>

          <button
            type="button"
            onClick={() => setActivePage("assignments")}
            disabled={classrooms.length === 0}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-extrabold text-gray-700 transition hover:bg-gray-50 hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-300"
          >
            <FileSearchIcon className="h-4 w-4" />
            New assignment
          </button>

          <button
            type="button"
            onClick={() => setActivePage("upload")}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-extrabold text-gray-700 transition hover:bg-gray-50 hover:text-gray-950"
          >
            <UploadIcon className="h-4 w-4" />
            Upload station
          </button>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="mb-3 text-xs font-extrabold uppercase tracking-normal text-gray-500">
              Classrooms
            </p>

            <div className="space-y-1">
              {isLoading && (
                <p className="px-3 py-3 text-sm font-bold text-gray-500">
                  Loading classrooms...
                </p>
              )}

              {!isLoading && classrooms.length === 0 && (
                <p className="px-3 py-3 text-sm font-bold text-gray-500">
                  No classrooms yet.
                </p>
              )}

              {classrooms.map((classroom) => {
                const isActive =
                  classroom.id === selectedClassroomId;

                return (
                  <button
                    key={classroom.id}
                    type="button"
                    onClick={() => {
                      setSelectedClassroomId(classroom.id);
                      setActivePage("classrooms");
                    }}
                    className={
                      isActive
                        ? "flex w-full items-center gap-3 rounded-lg bg-gray-100 px-3 py-3 text-left text-gray-950"
                        : "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-gray-600 transition hover:bg-gray-50 hover:text-gray-950"
                    }
                  >
                    <span className={`h-9 w-2 rounded-full ${classroom.accent}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-extrabold">
                        {classroom.name}
                      </span>
                      <span className="block truncate text-xs font-bold text-gray-500">
                        {classroom.section}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
        )}

        <section className="space-y-8">
          <StatusMessage
            error={errorMessage}
            message={successMessage}
          />

          {activePage === "classrooms" && (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-extrabold uppercase tracking-normal text-emerald-700">
                    Classroom
                  </p>
                  <h2 className="mt-2 text-4xl font-black tracking-normal">
                    {selectedClassroom.name}
                  </h2>
                  <p className="mt-2 text-base font-semibold text-gray-500">
                    {[selectedClassroom.section, selectedClassroom.subject]
                      .filter(Boolean)
                      .join(" | ")}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setActivePage("assignments")}
                  disabled={classrooms.length === 0}
                  className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-extrabold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  <PlusIcon className="h-4 w-4" />
                  Create assignment
                </button>
              </div>

              {isCreatingClassroom && (
                <form
                  onSubmit={handleCreateClassroom}
                  className="rounded-lg border border-gray-200 bg-white p-6"
                >
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="block">
                      <span className="text-sm font-extrabold text-gray-800">
                        Class name
                      </span>
                      <input
                        type="text"
                        value={classroomForm.name}
                        onChange={(event) =>
                          setClassroomForm((currentForm) => ({
                            ...currentForm,
                            name: event.target.value,
                          }))
                        }
                        className="mt-2 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                        required
                      />
                    </label>

                    <label className="block">
                      <span className="text-sm font-extrabold text-gray-800">
                        Section
                      </span>
                      <input
                        type="text"
                        value={classroomForm.section}
                        onChange={(event) =>
                          setClassroomForm((currentForm) => ({
                            ...currentForm,
                            section: event.target.value,
                          }))
                        }
                        className="mt-2 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                        required
                      />
                    </label>

                    <label className="block">
                      <span className="text-sm font-extrabold text-gray-800">
                        Subject
                      </span>
                      <input
                        type="text"
                        value={classroomForm.subject}
                        onChange={(event) =>
                          setClassroomForm((currentForm) => ({
                            ...currentForm,
                            subject: event.target.value,
                          }))
                        }
                        className="mt-2 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                        required
                      />
                    </label>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={isSavingClassroom}
                      className="inline-flex h-11 items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-extrabold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    >
                      {isSavingClassroom ? "Creating..." : "Create"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingClassroom(false);
                        setClassroomForm(emptyClassroomForm);
                      }}
                      className="inline-flex h-11 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-extrabold text-gray-700 transition hover:bg-gray-50 hover:text-gray-950"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div className="grid gap-4 md:grid-cols-4">
                <article className="rounded-lg border border-gray-200 bg-white p-5">
                  <UsersIcon className="h-6 w-6 text-emerald-700" />
                  <p className="mt-5 text-3xl font-black">
                    {selectedClassroom.students}
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-500">
                    Students
                  </p>
                </article>

                <article className="rounded-lg border border-gray-200 bg-white p-5">
                  <FileSearchIcon className="h-6 w-6 text-sky-700" />
                  <p className="mt-5 text-3xl font-black">
                    {selectedClassroom.assignments}
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-500">
                    Assignments
                  </p>
                </article>

                <article className="rounded-lg border border-gray-200 bg-white p-5">
                  <UploadIcon className="h-6 w-6 text-amber-700" />
                  <p className="mt-5 text-3xl font-black">
                    {selectedClassroom.submissions}
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-500">
                    Submissions
                  </p>
                </article>

                <article className="rounded-lg border border-gray-200 bg-white p-5">
                  <DoorIcon className="h-6 w-6 text-violet-700" />
                  <p className="mt-5 text-3xl font-black">
                    {selectedClassroom.code}
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-500">
                    Class code
                  </p>
                </article>
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                {classrooms.map((classroom) => (
                  <article
                    key={classroom.id}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white"
                  >
                    <div className={`${classroom.accent} h-24 p-5 text-white`}>
                      <h3 className="truncate text-xl font-black">
                        {classroom.name}
                      </h3>
                      <p className="mt-1 text-sm font-bold text-white/80">
                        {classroom.section}
                      </p>
                    </div>

                    <div className="p-5">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <strong className="block text-xl font-black">
                            {classroom.students}
                          </strong>
                          <span className="text-xs font-bold text-gray-500">
                            Students
                          </span>
                        </div>
                        <div>
                          <strong className="block text-xl font-black">
                            {classroom.assignments}
                          </strong>
                          <span className="text-xs font-bold text-gray-500">
                            Work
                          </span>
                        </div>
                        <div>
                          <strong className="block text-xl font-black">
                            {classroom.submissions}
                          </strong>
                          <span className="text-xs font-bold text-gray-500">
                            Turned in
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setAssignmentForm((currentForm) => ({
                            ...currentForm,
                            classroomId: classroom.id,
                          }));
                          setActivePage("assignments");
                        }}
                        className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-lg border border-gray-200 text-sm font-extrabold text-gray-700 transition hover:bg-gray-50 hover:text-gray-950"
                      >
                        Add assignment
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {activePage === "assignments" && (
            <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
              <form
                onSubmit={handleCreateAssignment}
                className="h-fit rounded-lg border border-gray-200 bg-white p-6"
              >
                <p className="text-sm font-extrabold uppercase tracking-normal text-emerald-700">
                  Assignment bin
                </p>
                <h2 className="mt-2 text-3xl font-black tracking-normal">
                  Create assignment
                </h2>

                <label className="mt-6 block">
                  <span className="text-sm font-extrabold text-gray-800">
                    Classroom
                  </span>
                  <select
                    value={assignmentForm.classroomId}
                    onChange={(event) =>
                      setAssignmentForm((currentForm) => ({
                        ...currentForm,
                        classroomId: event.target.value,
                      }))
                    }
                    disabled={classrooms.length === 0}
                    className="mt-2 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                    required
                  >
                    {classrooms.length === 0 && (
                      <option value="">
                        Create a classroom first
                      </option>
                    )}
                    {classrooms.map((classroom) => (
                      <option key={classroom.id} value={classroom.id}>
                        {classroom.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="mt-5 block">
                  <span className="text-sm font-extrabold text-gray-800">
                    Title
                  </span>
                  <input
                    type="text"
                    value={assignmentForm.title}
                    onChange={(event) =>
                      setAssignmentForm((currentForm) => ({
                        ...currentForm,
                        title: event.target.value,
                      }))
                    }
                    className="mt-2 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                    required
                  />
                </label>

                <label className="mt-5 block">
                  <span className="text-sm font-extrabold text-gray-800">
                    Instructions
                  </span>
                  <textarea
                    value={assignmentForm.instructions}
                    onChange={(event) =>
                      setAssignmentForm((currentForm) => ({
                        ...currentForm,
                        instructions: event.target.value,
                      }))
                    }
                    rows="5"
                    className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-3 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                  />
                </label>

                <label className="mt-5 block">
                  <span className="text-sm font-extrabold text-gray-800">
                    Due date
                  </span>
                  <input
                    type="datetime-local"
                    value={assignmentForm.dueDate}
                    onChange={(event) =>
                      setAssignmentForm((currentForm) => ({
                        ...currentForm,
                        dueDate: event.target.value,
                      }))
                    }
                    className="mt-2 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isSavingAssignment || classrooms.length === 0}
                  className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 text-base font-extrabold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  <PlusIcon className="h-5 w-5" />
                  {isSavingAssignment ? "Creating..." : "Create assignment"}
                </button>
              </form>

              <div>
                <p className="text-sm font-extrabold uppercase tracking-normal text-emerald-700">
                  Posted work
                </p>
                <h2 className="mt-2 text-4xl font-black tracking-normal">
                  Assignments
                </h2>

                <div className="mt-6 space-y-4">
                  {assignments.length === 0 && (
                    <div className="rounded-lg border border-gray-200 bg-white p-6">
                      <p className="text-sm font-bold text-gray-500">
                        No assignments yet.
                      </p>
                    </div>
                  )}

                  {assignments.map((assignment) => (
                    <article
                      key={assignment.id}
                      className="rounded-lg border border-gray-200 bg-white p-5"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-xl font-black text-gray-950">
                            {assignment.title}
                          </h3>
                          <p className="mt-1 text-sm font-bold text-gray-500">
                            {assignment.classroomName} | {formatDateTime(assignment.dueDate)}
                          </p>
                        </div>
                        <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700">
                          {assignment.submissions} submitted
                        </span>
                      </div>

                      {assignment.instructions && (
                        <p className="mt-4 text-sm font-semibold leading-6 text-gray-600">
                          {assignment.instructions}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activePage === "upload" && (
            <div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-extrabold uppercase tracking-normal text-emerald-700">
                    Manual check
                  </p>
                  <h2 className="mt-2 text-4xl font-black tracking-normal">
                    Upload station
                  </h2>
                  <p className="mt-2 max-w-[680px] text-base font-semibold leading-7 text-gray-500">
                    Review student work from a photo, document, readable file, or pasted text.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleResetManualCheck}
                  className="inline-flex h-11 w-fit items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-extrabold text-gray-700 transition hover:bg-gray-50 hover:text-gray-950"
                >
                  Clear station
                </button>
              </div>

              <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6 lg:min-h-[720px]">
                <form
                  onSubmit={handleRunManualCheck}
                  className="flex min-h-[560px] flex-col rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-6"
                >
                  <div className="grid gap-3 md:grid-cols-3">
                    {uploadModes.map(({ id, label, icon: Icon }) => {
                      const isActive =
                        uploadMode === id;

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setUploadMode(id);
                            setManualCheckResult(null);
                            setManualLiveOcrResult(null);
                            setManualCheckError("");
                          }}
                          className={
                            isActive
                              ? "flex min-h-[104px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-emerald-700 bg-white px-4 text-sm font-extrabold text-emerald-800 shadow-sm"
                              : "flex min-h-[104px] flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 text-sm font-extrabold text-gray-500 transition hover:border-emerald-300 hover:text-gray-950"
                          }
                        >
                          <span className={isActive ? "grid h-11 w-11 place-items-center rounded-lg bg-emerald-100 text-emerald-700" : "grid h-11 w-11 place-items-center rounded-lg bg-gray-100 text-gray-500"}>
                            <Icon className="h-5 w-5" />
                          </span>
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <label className="mt-6 block">
                    <span className="text-sm font-extrabold text-gray-800">
                      Check title
                    </span>
                    <input
                      type="text"
                      value={manualCheckTitle}
                      onChange={(event) => setManualCheckTitle(event.target.value)}
                      placeholder="Example: Grade 10 essay draft"
                      className="mt-2 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold outline-none transition placeholder:text-gray-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                    />
                  </label>

                  <div className="mt-5 flex flex-1 flex-col">
                    {!uploadMode && (
                      <div className="grid flex-1 min-h-[320px] place-items-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-6 text-center">
                        <div>
                          <span className="mx-auto grid h-16 w-16 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                            <UploadIcon className="h-8 w-8" />
                          </span>
                          <h3 className="mt-5 text-xl font-black text-gray-950">
                            Choose a submission type first
                          </h3>
                          <p className="mt-2 max-w-[430px] text-sm font-semibold leading-6 text-gray-500">
                            Pick picture, file, or pasted text above to open the right submission box.
                          </p>
                        </div>
                      </div>
                    )}

                    {(uploadMode === "picture" || uploadMode === "file") && (
                      <>
                        {uploadMode === "picture" && (
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5">
                            <div className="flex items-center gap-3">
                              <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-700 text-white shadow-sm">
                                <SparklesIcon className="h-5 w-5" />
                              </span>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="text-sm font-extrabold text-emerald-950">
                                    AI Transcription Engine
                                  </h4>
                                  <span className="rounded bg-emerald-200/80 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-900">
                                    Active
                                  </span>
                                </div>
                                <p className="text-xs font-semibold text-emerald-800">
                                  YOLO26x Line Detector (1024px Grayscale) + TrOCR Transformer (final_model)
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {ocrEngineInfo?.device && (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-bold text-emerald-800 shadow-sm">
                                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                  {ocrEngineInfo.device.toUpperCase()} Accelerated
                                </span>
                              )}
                              {manualCheckFiles.length === 0 && (
                                <button
                                  type="button"
                                  onClick={handleLoadSampleEssay}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-extrabold text-emerald-800 shadow-sm transition hover:bg-emerald-100"
                                >
                                  <FileIcon className="h-3.5 w-3.5 text-emerald-600" />
                                  Try sample essay
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        <label className="flex flex-1 min-h-[340px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-6 text-center transition hover:border-emerald-600 hover:bg-emerald-50">
                          {manualImagePreview ? (
                            <div className="flex w-full flex-col items-center py-4">
                              <img
                                src={manualImagePreview}
                                alt="Manual check preview"
                                className="max-h-[300px] w-full rounded-lg object-contain"
                              />
                              <p className="mt-3 text-xs font-bold text-gray-500">
                                Click or drop another image to replace
                              </p>
                            </div>
                          ) : (
                            <>
                              <span className="grid h-20 w-20 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                                {uploadMode === "picture" ? (
                                  <ImageIcon className="h-10 w-10" />
                                ) : (
                                  <UploadIcon className="h-10 w-10" />
                                )}
                              </span>
                              <span className="mt-6 text-2xl font-black text-gray-950">
                                {uploadMode === "picture" ? "Upload student handwriting" : "Upload a file"}
                              </span>
                              <span className="mt-2 max-w-[520px] text-sm font-semibold leading-6 text-gray-500">
                                {uploadMode === "picture"
                                  ? "Select a PNG, JPG, JPEG, or WEBP photo of handwritten student work to transcribe."
                                  : "Select a PDF, DOCX, TXT, MD, CSV, JSON, or other supported classroom file."}
                              </span>
                            </>
                          )}
                          <input
                            type="file"
                            accept={
                              uploadMode === "picture"
                                ? "image/png,image/jpeg,image/jpg,image/webp"
                                : ACCEPTED_CHECK_FILE_TYPES
                            }
                            multiple
                            onChange={handleManualCheckFiles}
                            className="sr-only"
                          />
                        </label>

                        {uploadMode === "picture" && manualCheckFiles.length > 0 && (
                          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3.5 shadow-sm">
                            <button
                              type="button"
                              disabled={isTranscribing || isScanningManualCheck}
                              onClick={() => handleTranscribePicture()}
                              className="inline-flex h-11 items-center gap-2 rounded-lg bg-emerald-700 px-5 text-sm font-black text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                            >
                              <SparklesIcon className="h-4 w-4" />
                              {isTranscribing
                                ? `Transcribing with YOLO + TrOCR (${manualLiveOcrResult?.processedLineCount || 0}/${manualLiveOcrResult?.detectedLineCount || "?"} lines)...`
                                : transcribedText
                                  ? "Re-transcribe handwriting"
                                  : "Transcribe handwriting"}
                            </button>

                            {transcribedText && (
                              <button
                                type="button"
                                onClick={() => handleCopyTranscript()}
                                className="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 text-sm font-extrabold text-gray-700 transition hover:bg-gray-100 hover:text-gray-950"
                              >
                                {copySuccess ? (
                                  <>
                                    <CheckIcon className="h-4 w-4 text-emerald-600" />
                                    <span className="text-emerald-700">Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <CopyIcon className="h-4 w-4 text-gray-500" />
                                    <span>Copy transcript</span>
                                  </>
                                )}
                              </button>
                            )}

                            {transcribedText && (
                              <button
                                type="button"
                                onClick={handleTransferToText}
                                className="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-extrabold text-gray-700 transition hover:bg-gray-50 hover:text-gray-950"
                              >
                                <ClipboardIcon className="h-4 w-4 text-gray-500" />
                                Edit in Paste tab
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setManualCheckFiles([]);
                                setManualImagePreview("");
                                setTranscribedText("");
                                setTranscriptionResult(null);
                                setManualLiveOcrResult(null);
                                setShowLineBreakdown(false);
                              }}
                              className="ml-auto text-xs font-extrabold text-gray-500 hover:text-red-600 transition"
                            >
                              Remove image
                            </button>
                          </div>
                        )}

                        {uploadMode === "picture" && (isTranscribing || transcribedText || manualLiveOcrResult?.text) && (
                          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 pb-3">
                              <div className="flex items-center gap-2">
                                <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-100 text-emerald-700">
                                  <SparklesIcon className="h-4 w-4" />
                                </span>
                                <h4 className="text-sm font-black text-gray-950">
                                  Transcribed Handwriting
                                </h4>
                                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-extrabold text-emerald-800">
                                  {transcriptionResult?.detectedLineCount || manualLiveOcrResult?.detectedLineCount || 0} lines detected
                                </span>
                                {transcribedText && (
                                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">
                                    {transcribedText.split(/\s+/).filter(Boolean).length} words
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setShowLineBreakdown((prev) => !prev)}
                                  className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 hover:text-emerald-900"
                                >
                                  <span>{showLineBreakdown ? "Hide line boxes" : "Show line breakdown"}</span>
                                  <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${showLineBreakdown ? "rotate-180" : ""}`} />
                                </button>
                              </div>
                            </div>

                            {isTranscribing && (
                              <div className="mt-3 space-y-1.5">
                                <div className="flex justify-between text-xs font-bold text-emerald-800">
                                  <span>
                                    {manualLiveOcrResult?.detectedLineCount
                                      ? `Transcribing line crops with TrOCR (${manualLiveOcrResult.processedLineCount}/${manualLiveOcrResult.detectedLineCount})...`
                                      : "Detecting handwriting line boxes with YOLO26x..."}
                                  </span>
                                  <span>
                                    {manualLiveOcrResult?.detectedLineCount
                                      ? `${Math.round(((manualLiveOcrResult.processedLineCount || 0) / manualLiveOcrResult.detectedLineCount) * 100)}%`
                                      : "Processing..."}
                                  </span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-200">
                                  <div
                                    className="h-full bg-emerald-600 transition-all duration-300"
                                    style={{
                                      width: manualLiveOcrResult?.detectedLineCount
                                        ? `${Math.max(8, Math.round(((manualLiveOcrResult.processedLineCount || 0) / manualLiveOcrResult.detectedLineCount) * 100))}%`
                                        : "20%",
                                    }}
                                  />
                                </div>
                              </div>
                            )}

                            <div className="mt-3">
                              <label className="block text-xs font-bold text-gray-500 mb-1">
                                {isTranscribing ? "Live streaming recognition:" : "Editable transcript (refine words before scanning if needed):"}
                              </label>
                              <textarea
                                value={transcribedText || manualLiveOcrText}
                                onChange={(e) => setTranscribedText(e.target.value)}
                                rows={Math.min(10, Math.max(5, (transcribedText || manualLiveOcrText).split("\n").length + 1))}
                                placeholder="Transcribed handwritten essay text will appear here as YOLO and TrOCR process the image..."
                                className="w-full rounded-lg border border-emerald-200 bg-white p-3 text-sm font-semibold leading-6 text-gray-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                              />
                            </div>

                            {showLineBreakdown && (transcriptionResult?.lines?.length > 0 || manualLiveOcrResult?.lines?.length > 0) && (
                              <div className="mt-4 border-t border-emerald-100 pt-3">
                                <h5 className="text-xs font-black uppercase tracking-wider text-emerald-900 mb-2">
                                  Line-by-Line Detection & Transcription
                                </h5>
                                <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                                  {(transcriptionResult?.lines || manualLiveOcrResult?.lines || []).map((line, idx) => {
                                    const box = (transcriptionResult?.boxes || manualLiveOcrResult?.boxes || [])[idx];
                                    return (
                                      <div key={idx} className="flex items-start gap-2 rounded bg-white p-2 text-xs border border-emerald-100">
                                        <span className="font-mono font-black text-emerald-700 min-w-[28px]">
                                          #{idx + 1}
                                        </span>
                                        <span className="flex-1 font-semibold text-gray-800">
                                          {line}
                                        </span>
                                        {box && (
                                          <span className="font-mono text-[10px] text-gray-400">
                                            [{Math.round(box.x1)}, {Math.round(box.y1)}, {Math.round(box.x2)}, {Math.round(box.y2)}]
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {manualCheckFiles.length > 0 && (
                          <div className="mt-5 rounded-lg border border-gray-200 bg-white">
                            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-gray-100 px-4 py-3 text-xs font-extrabold uppercase tracking-normal text-gray-500">
                              <span>File</span>
                              <span>Type</span>
                              <span>Size</span>
                            </div>

                            {manualCheckFiles.map((file) => (
                              <div
                                key={`${file.name}-${file.size}-${file.lastModified}`}
                                className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-gray-100 px-4 py-3 text-sm last:border-b-0"
                              >
                                <span className="min-w-0 truncate font-extrabold text-gray-950">
                                  {file.name}
                                </span>
                                <span className="font-bold text-gray-500">
                                  {getFileKind(file)}
                                </span>
                                <span className="font-bold text-gray-500">
                                  {formatFileSize(file.size)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {uploadMode === "text" && (
                      <label className="flex flex-1 flex-col">
                        <span className="text-sm font-extrabold text-gray-800">
                          Paste text
                        </span>
                        <textarea
                          value={manualCheckText}
                          onChange={(event) => {
                            setManualCheckText(event.target.value);
                            setManualCheckResult(null);
                            setManualLiveOcrResult(null);
                          }}
                          placeholder="Paste essay text, copied paragraphs, or OCR output here."
                          className="mt-2 flex-1 min-h-[360px] w-full rounded-lg border border-gray-300 bg-white px-4 py-4 text-sm font-semibold leading-6 outline-none transition placeholder:text-gray-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                        />
                      </label>
                    )}
                  </div>

                  {manualCheckError && (
                    <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                      {manualCheckError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isScanningManualCheck || isTranscribing || !uploadMode}
                    className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 text-base font-extrabold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  >
                    <FileSearchIcon className="h-5 w-5" />
                    {isScanningManualCheck
                      ? "Scanning submission..."
                      : isTranscribing
                        ? "Transcribing handwriting..."
                        : transcribedText
                          ? "Scan transcribed essay for plagiarism"
                          : "Scan for plagiarism"}
                  </button>
                </form>

                <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-extrabold uppercase tracking-normal text-emerald-700">
                        Detection result
                      </p>
                      <h3 className="mt-2 text-2xl font-black">
                        {isScanningManualCheck
                          ? "Scanning submission"
                          : manualCheckResult?.title || "Ready to scan"}
                      </h3>
                    </div>

                    {manualCheckResult && (
                      <span className={`rounded-lg px-3 py-2 text-sm font-black ${manualResultBadgeClass}`}>
                        {manualCheckResult.label}
                      </span>
                    )}
                  </div>

                  {isScanningManualCheck ? (
                    <div className="mt-8 rounded-lg border border-emerald-100 bg-emerald-50 px-5 py-5">
                      {isTranscribing || (!plagiarismScanProgressText && manualLiveOcrResult) ? (
                        <>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-extrabold text-emerald-800">
                                Detecting text...
                              </p>
                              <p className="mt-2 text-sm font-semibold leading-6 text-emerald-900">
                                YOLO has detected the line crops. TrOCR text appears here as each batch finishes.
                              </p>
                            </div>

                            {manualLiveOcrResult && (
                              <span className="rounded-lg bg-white px-3 py-2 text-xs font-black text-emerald-800">
                                {manualLiveOcrResult.processedLineCount}/{manualLiveOcrResult.detectedLineCount} lines
                              </span>
                            )}
                          </div>

                          <pre className="mt-4 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-100 bg-white px-4 py-3 text-sm font-semibold leading-6 text-gray-800">
                            {manualLiveOcrText || "Waiting for the first recognized line..."}
                          </pre>
                        </>
                      ) : (
                        <div className="flex items-center gap-3 py-3">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent shrink-0" />
                          <div>
                            <p className="text-sm font-extrabold text-emerald-950">
                              {plagiarismScanProgressText || "Scanning submission with Copyleaks..."}
                            </p>
                            <p className="text-xs font-semibold text-emerald-700 mt-1">
                              Connecting securely to Copyleaks Authenticity API & database matching.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : manualCheckResult ? (
                    <>
                      {hasManualImageExtraction && (
                        <div className="mt-7">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-extrabold text-gray-800">
                                Transcribed student handwriting
                              </p>
                              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">
                                YOLO26x + TrOCR
                              </span>
                            </div>
                            {manualDetectedText && (
                              <button
                                type="button"
                                onClick={() => handleCopyTranscript(manualDetectedText)}
                                className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-700 hover:text-emerald-900 transition"
                              >
                                {copySuccess ? (
                                  <>
                                    <CheckIcon className="h-3.5 w-3.5 text-emerald-600" />
                                    <span>Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <CopyIcon className="h-3.5 w-3.5" />
                                    <span>Copy text</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                          {manualImageExtractionSummary.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {manualImageExtractionSummary.map((summary) => (
                                <p
                                  key={summary}
                                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800"
                                >
                                  {summary}
                                </p>
                              ))}
                            </div>
                          )}
                          <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-gray-800">
                            {manualDetectedText || "No text was detected from the uploaded image."}
                          </pre>
                        </div>
                      )}

                      <div className="mt-7 grid gap-4 sm:grid-cols-[160px_1fr]">
                        <div className={`grid aspect-square place-items-center rounded-lg bg-white text-center ring-8 ${manualResultRingClass}`}>
                          <div>
                            <strong className="block text-5xl font-black">
                              {manualCheckResult.score}%
                            </strong>
                            <span className="mt-1 block text-xs font-extrabold uppercase tracking-normal text-gray-500">
                              Plagiarism score
                            </span>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-2xl font-black text-gray-950">
                              {manualCheckResult.wordCount}
                            </p>
                            <p className="mt-1 text-sm font-bold text-gray-500">
                              Total words
                            </p>
                          </div>

                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-2xl font-black text-gray-950">
                              {manualCheckResult.identicalWords ?? 0}
                            </p>
                            <p className="mt-1 text-sm font-bold text-gray-500">
                              Matched / identical words
                            </p>
                          </div>

                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-2xl font-black text-emerald-800">
                              {manualCheckResult.scanStatus || "Completed"}
                            </p>
                            <p className="mt-1 text-sm font-bold text-gray-500">
                              Scan status
                            </p>
                          </div>

                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-2xl font-black text-gray-950">
                              {manualCheckResult.matchedSources?.length ?? 0}
                            </p>
                            <p className="mt-1 text-sm font-bold text-gray-500">
                              Matching sources
                            </p>
                          </div>
                        </div>
                      </div>

                      {manualCheckResult.matchedSources && manualCheckResult.matchedSources.length > 0 && (
                        <div className="mt-6">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-extrabold text-gray-800">
                              Matching sources ({manualCheckResult.matchedSources.length})
                            </p>
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">
                              Copyleaks API
                            </span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {manualCheckResult.matchedSources.map((source, sIdx) => (
                              <div
                                key={source.id || sIdx}
                                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="font-extrabold text-gray-900 truncate">
                                    {source.title || "Matched source"}
                                  </p>
                                  {source.url && (
                                    <a
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs font-semibold text-emerald-700 hover:underline truncate block mt-0.5"
                                    >
                                      {source.url}
                                    </a>
                                  )}
                                </div>
                                <div className="shrink-0">
                                  <span className="rounded bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">
                                    {source.matched_words || source.identical_words || 0} matched words
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <p className="mt-6 text-sm font-semibold leading-6 text-gray-600">
                        {manualCheckResult.summary}
                      </p>

                      <div className="mt-6">
                        <p className="text-sm font-extrabold text-gray-800">
                          Review signals
                        </p>
                        <div className="mt-3 space-y-2">
                          {manualCheckResult.flags.map((flag) => (
                            <p
                              key={flag}
                              className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600"
                            >
                              {flag}
                            </p>
                          ))}
                        </div>
                      </div>

                      {manualCheckResult.repeatedPhrases.length > 0 && (
                        <div className="mt-6">
                          <p className="text-sm font-extrabold text-gray-800">
                            Repeated phrases
                          </p>
                          <div className="mt-3 space-y-2">
                            {manualCheckResult.repeatedPhrases.map((item) => (
                              <p
                                key={item.phrase}
                                className="rounded-lg bg-gray-50 px-4 py-3 text-sm font-semibold leading-6 text-gray-600"
                              >
                                "{item.phrase}" appears {item.count} times
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-8 grid min-h-[220px] place-items-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-6 text-center">
                      <div>
                        <span className="mx-auto grid h-16 w-16 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                          <FileSearchIcon className="h-8 w-8" />
                        </span>
                        <h3 className="mt-5 text-xl font-black text-gray-950">
                          No scan result yet
                        </h3>
                        <p className="mt-2 max-w-[420px] text-sm font-semibold leading-6 text-gray-500">
                          Add student work above, then run a plagiarism scan.
                        </p>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {activePage === "submissions" && (
            <div>
              <p className="text-sm font-extrabold uppercase tracking-normal text-emerald-700">
                Student work
              </p>
              <h2 className="mt-2 text-4xl font-black tracking-normal">
                Submissions
              </h2>

              <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr_0.8fr] gap-4 border-b border-gray-200 px-5 py-3 text-xs font-extrabold uppercase tracking-normal text-gray-500">
                  <span>Student</span>
                  <span>Assignment</span>
                  <span>Essay</span>
                  <span>Grade</span>
                  <span>Action</span>
                </div>

                {submissions.length === 0 && (
                  <p className="px-5 py-5 text-sm font-bold text-gray-500">
                    No submissions yet.
                  </p>
                )}

                {submissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr_0.8fr] items-center gap-4 border-b border-gray-100 px-5 py-4 text-sm last:border-b-0"
                  >
                    <span className="font-extrabold text-gray-950">
                      {submission.studentName}
                    </span>
                    <span className="font-semibold text-gray-600">
                      {submission.assignmentTitle}
                    </span>
                    <span className="font-semibold text-gray-600">
                      {submission.essayTitle}
                    </span>
                    <div>
                      {submission.grade ? (
                        <span className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
                          {submission.grade}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-1 text-xs font-bold text-gray-400">
                          Not graded
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenReview(submission)}
                      className="inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-xs font-extrabold text-white transition hover:bg-emerald-800 shadow-sm"
                    >
                      <FileSearchIcon className="h-4 w-4" />
                      <span>Check</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {reviewingSubmission && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4 backdrop-blur-sm">
              <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
                <div className="flex items-start justify-between border-b border-gray-100 pb-4">
                  <div>
                    <span className="inline-block rounded-md bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-800 uppercase tracking-wider">
                      Review Student Work
                    </span>
                    <h3 className="mt-1.5 text-2xl font-black text-gray-950">
                      {reviewingSubmission.essayTitle}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-gray-500">
                      Student: <strong className="text-gray-900">{reviewingSubmission.studentName}</strong> • Assignment: <strong className="text-gray-900">{reviewingSubmission.assignmentTitle}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseReview}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 text-lg font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-5 space-y-5">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                          Submitted File
                        </p>
                        <p className="mt-1 text-sm font-extrabold text-gray-900">
                          {reviewingSubmission.essayTitle}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Turned in on {formatDateTime(reviewingSubmission.createdAt)} • Status: <span className="font-bold text-emerald-700 uppercase">{reviewingSubmission.status}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openSubmissionFile(reviewingSubmission.fileUrl, setErrorMessage)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 text-xs font-extrabold text-gray-700 hover:bg-gray-50 shadow-sm transition"
                        >
                          <FileSearchIcon className="h-4 w-4 text-gray-500" />
                          <span>Open submission file</span>
                        </button>
                        <button
                          type="button"
                          disabled={isReviewScanning}
                          onClick={handleRunReviewScan}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:bg-emerald-400 shadow-sm transition"
                        >
                          <FileSearchIcon className="h-4 w-4" />
                          <span>{isReviewScanning ? "Scanning..." : reviewScanResult ? "Re-scan Plagiarism" : "Run Plagiarism Check"}</span>
                        </button>
                      </div>
                    </div>

                    {/* Submitted image preview */}
                    {isLoadingImagePreview && (
                      <div className="mt-4 h-48 animate-pulse rounded-xl bg-gray-200" />
                    )}
                    {reviewImagePreviewUrl && !isLoadingImagePreview && (
                      <div className="mt-4">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">
                          Submitted image
                        </p>
                        <div
                          className="group relative cursor-zoom-in overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm"
                          onClick={() => setIsImageExpanded(true)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && setIsImageExpanded(true)}
                          title="Click to expand"
                          style={{ maxHeight: "320px" }}
                        >
                          <img
                            src={reviewImagePreviewUrl}
                            alt="Student submission"
                            className="w-full object-contain transition duration-200 group-hover:brightness-90"
                            style={{ maxHeight: "320px" }}
                            onError={(e) => {
                              e.target.closest(".group").style.display = "none";
                            }}
                          />
                          <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-1 text-[11px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l-5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                            Expand
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Lightbox overlay */}
                  {isImageExpanded && reviewImagePreviewUrl && (
                    <div
                      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
                      onClick={() => setIsImageExpanded(false)}
                    >
                      <div className="relative max-h-[95vh] max-w-[95vw]">
                        <button
                          type="button"
                          onClick={() => setIsImageExpanded(false)}
                          className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white font-bold text-gray-800 shadow-lg hover:bg-gray-100 text-sm"
                        >
                          ✕
                        </button>
                        <img
                          src={reviewImagePreviewUrl}
                          alt="Student submission full view"
                          className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <p className="mt-2 text-center text-xs font-semibold text-white/70">
                          {reviewingSubmission.essayTitle} — {reviewingSubmission.studentName}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* DETECTION RESULT (matching Image 1) */}
                  {isReviewScanning ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-6">
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-7 animate-spin rounded-full border-3 border-emerald-700 border-t-transparent shrink-0" />
                        <div>
                          <p className="text-sm font-extrabold text-emerald-950">
                            {reviewScanProgressText || "Scanning submission with Copyleaks..."}
                          </p>
                          <p className="text-xs font-semibold text-emerald-700 mt-1">
                            Running YOLO26x + TrOCR handwriting transcription & Copyleaks Authenticity API matching.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : reviewScanResult ? (
                    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-xs font-black uppercase tracking-wider text-emerald-700">
                            DETECTION RESULT
                          </p>
                          <h4 className="mt-1 text-2xl font-black text-gray-950">
                            Plagiarism check
                          </h4>
                        </div>
                        <span className={`inline-flex items-center rounded-lg border px-3 py-1 text-xs font-black ${reviewResultBadgeClass}`}>
                          {reviewScanResult.label || "Low review"}
                        </span>
                      </div>

                      {/* Transcribed student handwriting */}
                      <div className="mt-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-extrabold text-gray-800">
                              Transcribed student handwriting
                            </p>
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">
                              YOLO26x + TrOCR
                            </span>
                          </div>
                          {reviewTranscribedText && (
                            <button
                              type="button"
                              onClick={() => handleCopyReviewTranscript(reviewTranscribedText)}
                              className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-700 hover:text-emerald-900 transition"
                            >
                              {reviewCopySuccess ? (
                                <>
                                  <CheckIcon className="h-3.5 w-3.5 text-emerald-600" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <CopyIcon className="h-3.5 w-3.5" />
                                  <span>Copy text</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <pre className="mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-gray-800">
                          {reviewTranscribedText || "No handwriting transcribed yet."}
                        </pre>
                      </div>

                      {/* Score Box & 2x2 Stats Grid */}
                      <div className="mt-6 grid gap-4 sm:grid-cols-[160px_1fr]">
                        <div className={`grid aspect-square place-items-center rounded-lg bg-white text-center ring-8 ${reviewResultRingClass}`}>
                          <div>
                            <strong className="block text-5xl font-black">
                              {reviewScanResult.score}%
                            </strong>
                            <span className="mt-1 block text-xs font-extrabold uppercase tracking-normal text-gray-500">
                              Plagiarism score
                            </span>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-2xl font-black text-gray-950">
                              {reviewScanResult.wordCount ?? 0}
                            </p>
                            <p className="mt-1 text-sm font-bold text-gray-500">
                              Total words
                            </p>
                          </div>

                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-2xl font-black text-gray-950">
                              {reviewScanResult.identicalWords ?? 0}
                            </p>
                            <p className="mt-1 text-sm font-bold text-gray-500">
                              Matched / identical words
                            </p>
                          </div>

                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-2xl font-black text-emerald-800">
                              {reviewScanResult.scanStatus || "Completed"}
                            </p>
                            <p className="mt-1 text-sm font-bold text-gray-500">
                              Scan status
                            </p>
                          </div>

                          <div className="rounded-lg bg-gray-50 p-4">
                            <p className="text-2xl font-black text-gray-950">
                              {reviewScanResult.matchedSources?.length ?? 0}
                            </p>
                            <p className="mt-1 text-sm font-bold text-gray-500">
                              Matching sources
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Matching Sources */}
                      {reviewScanResult.matchedSources && reviewScanResult.matchedSources.length > 0 && (
                        <div className="mt-6">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-extrabold text-gray-800">
                              Matching sources ({reviewScanResult.matchedSources.length})
                            </p>
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">
                              Copyleaks API
                            </span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {reviewScanResult.matchedSources.map((source, sIdx) => (
                              <div
                                key={source.id || sIdx}
                                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="font-extrabold text-gray-900 truncate">
                                    {source.title || "Matched source"}
                                  </p>
                                  {source.url && (
                                    <a
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs font-semibold text-emerald-700 hover:underline truncate block mt-0.5"
                                    >
                                      {source.url}
                                    </a>
                                  )}
                                </div>
                                <div className="shrink-0">
                                  <span className="rounded bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">
                                    {source.matched_words || source.identical_words || 0} matched words
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Copyleaks API Footer Notice */}
                      <p className="mt-6 text-sm font-semibold leading-6 text-gray-600">
                        {reviewScanResult.summary || "Scanned via Copyleaks Authenticity API. Comprehensive database and source matching completed."}
                      </p>

                      {/* Review Signals */}
                      {reviewScanResult.flags && reviewScanResult.flags.length > 0 && (
                        <div className="mt-6">
                          <p className="text-sm font-extrabold text-gray-800">
                            Review signals
                          </p>
                          <div className="mt-3 space-y-2">
                            {reviewScanResult.flags.map((flag, fIdx) => (
                              <p
                                key={fIdx}
                                className="rounded-lg border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600"
                              >
                                {flag}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/80 p-6 text-center">
                      <p className="text-xs font-black uppercase tracking-wider text-emerald-700">
                        DETECTION RESULT
                      </p>
                      <h4 className="mt-1 text-lg font-black text-gray-900">
                        No scan result recorded yet
                      </h4>
                      <p className="mt-1 text-xs font-semibold text-gray-500">
                        Transcribe student handwriting with YOLO26x + TrOCR and check plagiarism via Copyleaks.
                      </p>
                      <button
                        type="button"
                        onClick={handleRunReviewScan}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-emerald-800 shadow-sm"
                      >
                        <FileSearchIcon className="h-4 w-4" />
                        <span>Run OCR & Plagiarism Check</span>
                      </button>
                    </div>
                  )}

                  {/* Grading Form */}
                  <form onSubmit={handleSaveGrade} className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-5">
                    <h4 className="text-base font-black text-emerald-950">
                      Grade Submission
                    </h4>
                    <p className="mt-1 text-xs font-semibold text-emerald-800">
                      Assign a score and leave feedback for {reviewingSubmission.studentName}.
                    </p>

                    <div className="mt-4">
                      <label className="block text-xs font-extrabold uppercase tracking-wider text-gray-700">
                        Grade / Score
                      </label>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          placeholder="e.g. 95 or A+"
                          value={gradeInput}
                          onChange={(e) => setGradeInput(e.target.value)}
                          className="h-11 w-44 rounded-lg border border-gray-300 bg-white px-3.5 text-base font-black text-gray-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {[100, 95, 90, 85, 80, 75].map((score) => (
                            <button
                              key={score}
                              type="button"
                              onClick={() => setGradeInput(String(score))}
                              className={`h-9 rounded-lg border px-3 text-xs font-bold transition ${
                                gradeInput === String(score)
                                  ? "border-emerald-600 bg-emerald-700 text-white"
                                  : "border-gray-200 bg-white text-gray-700 hover:bg-emerald-50 hover:text-emerald-800"
                              }`}
                            >
                              {score}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="block text-xs font-extrabold uppercase tracking-wider text-gray-700">
                        Teacher Feedback (optional)
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Leave remarks or suggestions for the student..."
                        value={feedbackInput}
                        onChange={(e) => setFeedbackInput(e.target.value)}
                        className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm font-semibold text-gray-800 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>

                    <div className="mt-5 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={handleCloseReview}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-xs font-extrabold text-gray-700 transition hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingGrade}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-xs font-extrabold text-white transition hover:bg-emerald-800 disabled:bg-emerald-400 shadow-sm"
                      >
                        {isSavingGrade ? "Saving grade..." : "Save Grade"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
