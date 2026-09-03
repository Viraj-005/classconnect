import { useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CONTENT_CHIP,
  Field,
  IconChip,
  Input,
  PageHeader,
  Progress,
  SearchInput,
  Segmented,
  Select,
  Tabs,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { cx, formatDate, relativeTime } from "@/lib/cx";
import { teacherApi, uploadContentFile } from "@/lib/api";
import { useApi, useMutation } from "@/lib/useApi";
import { QuizBuilder, QuizResults } from "./QuizBuilder";
import { useDebounced } from "@/lib/useDebounced";

/*
  Content library.

  Two views on the same data. Grid is for recognising your own material
  by shape, list is for the reach numbers. Grid is the default because
  recognition beats sorting when the library is small, which it is for
  most tenants.

  Filtering is done server side. Fetching everything and filtering in
  the browser works at eight items and falls over at eight hundred.
*/

function UploadPanel({ onClose, onCreated, onBuildQuiz }) {
  const [over, setOver] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("doc");
  const picker = useRef(null);
  const [picked, setPicked] = useState(null);
  const [progress, setProgress] = useState(null);

  /* Only a shape check here. The server owns the real allowlist, and a
     check in the browser is a courtesy to the person, not a control. */
  const pick = (file) => {
    if (!file) return;
    setPicked(file);
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    if (type === "quiz") setType(file.type.startsWith("video/") ? "video" : "doc");
  };

  /*
    Choosing "Quiz" here used to create a Content row with no questions.
    The student endpoint refuses a quiz with none, so that produced an
    item that looked fine on the shelf and could never be opened. A quiz
    goes to the builder instead, which is where the questions are.
  */
  const create = useMutation(async () => {
    if (type === "quiz") {
      onBuildQuiz({ title: title.trim(), subject: subject.trim() });
      onClose();
      return;
    }
    /* The content row first, because its id is part of the storage
       key, then the bytes. A failed upload leaves the row, which is
       recoverable by uploading again, rather than orphaning a file
       nothing points at. */
    const created = await teacherApi.createContent({
      title,
      subject: subject || null,
      type,
    });
    if (picked) {
      setProgress(0);
      try {
        await uploadContentFile(created.contentId, picked, setProgress);
      } finally {
        setProgress(null);
      }
    }
    setTitle("");
    setSubject("");
    setPicked(null);
    onCreated();
    onClose();
  });

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <div className="eyebrow mb-1">New material</div>
          <h3 className="text-md font-semibold">Add to the library</h3>
        </div>
        <Button size="sm" variant="ghost" icon="close" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="px-5 pb-5">
        <input
          ref={picker}
          type="file"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          onClick={() => picker.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") picker.current?.click();
          }}
          className={cx(
            "rounded-[var(--radius-md)] border-2 border-dashed px-6 py-7 text-center",
            "transition-colors duration-[var(--dur-fast)]",
            over
              ? "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)]"
              : "border-hairline bg-sunken",
          )}
        >
          <span
            className={cx(
              "inline-flex items-center justify-center size-12 rounded-[var(--radius-md)] mb-3",
              "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]",
              over && "pulse-ring",
            )}
          >
            <Icon name="upload" size={22} />
          </span>
          <p className="text-sm font-semibold">
            {picked ? picked.name : "Drop a file here, or click to browse"}
          </p>
          {/*
            Files go to local disk under apps/api/media, with their
            metadata in Postgres. The upload happens after the content
            row exists, because the row's id is part of the storage key.
          */}
          <p className="text-xs text-ink-500 mt-1">
            {picked
              ? `${(picked.size / 1024 / 1024).toFixed(1)} MB, uploads when you save`
              : "Video, audio, PDF, Office documents and images. Up to 512 MB."}
          </p>
          {progress !== null && (
            <div className="mt-3 h-1.5 rounded-full bg-ink-100 overflow-hidden max-w-xs mx-auto">
              <div
                className="h-full rounded-full bg-[var(--portal-accent)] transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <Field label="Title" required className="sm:col-span-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Integration by parts, worked problems"
            />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="video">Video</option>
              <option value="doc">Document</option>
              <option value="quiz">Quiz</option>
            </Select>
          </Field>
        </div>
        <Field label="Subject" className="mt-3">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Combined Maths"
          />
        </Field>

        {create.error && (
          <p className="text-xs text-danger-fg mt-3">{create.error.message}</p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <Button
            variant="primary"
            disabled={!title.trim()}
            loading={create.pending}
            onClick={create.mutate}
          >
            {type === "quiz" ? "Write the questions" : "Add to library"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ContentCard({ item, onEditQuiz, onSeeResults }) {
  const chip = CONTENT_CHIP[item.type];
  return (
    <Card className="group overflow-hidden hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5 transition-all duration-[var(--dur-med)] ease-[var(--ease-out)]">
      {/* Generated pattern keyed to the type rather than a stock image.
          Cheap, on brand, and it never looks like filler. */}
      <div
        className="relative h-28 flex items-center justify-center"
        style={{
          background:
            item.type === "video"
              ? "var(--brand-gradient)"
              : item.type === "quiz"
                ? "linear-gradient(135deg, var(--warning-mid), var(--warning-fg))"
                : "linear-gradient(135deg, var(--accent-500), var(--accent-600))",
        }}
      >
        <svg
          className="absolute inset-0 w-full h-full opacity-[0.16]"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern
              id={`p-${item.contentId}`}
              width="22"
              height="22"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1.4" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#p-${item.contentId})`} />
        </svg>
        <Icon name={chip.icon} size={30} className="text-white/90 relative" />
        {item.durationMins ? (
          <span className="absolute bottom-2 right-2 rounded-[var(--radius-xs)] bg-black/45 text-white text-[10px] font-bold px-1.5 py-0.5 tnum">
            {item.durationMins} min
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Badge tone={chip.tone}>{item.type}</Badge>
          <span className="text-2xs text-ink-500 truncate">{item.subject}</span>
        </div>
        <h3 className="text-sm font-semibold leading-snug line-clamp-2 min-h-[2.6em]">
          {item.title}
        </h3>
        <div className="mt-3 flex items-center gap-2">
          <Progress value={item.reachPct} height={5} />
          <span className="text-2xs font-bold tnum text-ink-600 shrink-0">{item.reachPct}%</span>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-hairline">
          <span className="text-2xs text-ink-500 truncate">{relativeTime(item.createdAt)}</span>
          <span className="flex items-center gap-1 text-2xs font-semibold text-ink-600">
            <Icon name="play" size={11} />
            {item.views}
          </span>
        </div>

        {/*
          A quiz is the one content type a teacher can genuinely review,
          because the product holds the whole thing: the questions and
          every answer given. A video or document is a file that is not
          uploaded yet, so there is nothing honest to offer there.
        */}
        {item.type === "quiz" && (
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="secondary"
              icon="quiz"
              className="flex-1"
              onClick={() => onEditQuiz(item.contentId)}
            >
              Questions
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="chart"
              className="flex-1"
              onClick={() => onSeeResults(item.contentId)}
            >
              Results
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function ContentLibrary() {
  const [tab, setTab] = useState("all");
  const [view, setView] = useState("grid");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");
  const [uploading, setUploading] = useState(false);
  /* The quiz being written, and the quiz whose results are being read.
     Both are overlays: writing a quiz is a task of its own, and the
     library behind it is not useful while you are in one. */
  const [building, setBuilding] = useState(null);
  const [results, setResults] = useState(null);

  const debouncedQuery = useDebounced(query, 250);

  const subjects = useApi(() => teacherApi.subjects(), []);
  const { data, loading, error, reload } = useApi(
    () => teacherApi.content({ type: tab, subject, q: debouncedQuery }),
    [tab, subject, debouncedQuery],
  );

  /* Counts come from an unfiltered fetch so the tabs do not all read
     zero the moment a filter excludes everything. */
  const all = useApi(() => teacherApi.content(), []);
  const counts = useMemo(() => {
    const rows = all.data ?? [];
    return {
      all: rows.length,
      video: rows.filter((c) => c.type === "video").length,
      doc: rows.filter((c) => c.type === "doc").length,
      quiz: rows.filter((c) => c.type === "quiz").length,
    };
  }, [all.data]);

  const rows = data ?? [];
  const filtered = query !== debouncedQuery || subject !== "all" || tab !== "all";

  const refreshAll = () => {
    reload();
    all.reload();
  };

  return (
    <div>
      {building && (
        <QuizBuilder
          quizId={building.quizId}
          draft={building}
          onClose={() => setBuilding(null)}
          onSaved={refreshAll}
        />
      )}
      {results && <QuizResults quizId={results} onClose={() => setResults(null)} />}
      <PageHeader
        eyebrow="Library"
        title="Content"
        sub="Everything published to your batches, organised by subject and date."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setUploading(true)}>
            Add content
          </Button>
        }
      />

      {uploading && (
        <UploadPanel
          onClose={() => setUploading(false)}
          onCreated={refreshAll}
          onBuildQuiz={(draft) => setBuilding(draft)}
        />
      )}

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by title"
            className="flex-1 min-w-[200px]"
          />
          <Select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-48">
            <option value="all">All subjects</option>
            {(subjects.data ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Segmented
            value={view}
            onChange={setView}
            items={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
          />
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          className="px-3"
          items={[
            { value: "all", label: "Everything", count: counts.all },
            { value: "video", label: "Videos", icon: "video", count: counts.video },
            { value: "doc", label: "Documents", icon: "doc", count: counts.doc },
            { value: "quiz", label: "Quizzes", icon: "quiz", count: counts.quiz },
          ]}
        />
      </Card>

      {error ? (
        <Card>
          <ErrorState body={error.message} onRetry={reload} />
        </Card>
      ) : loading ? (
        <Card className="overflow-hidden">
          <SkeletonRows rows={6} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            art="list"
            title={filtered ? "Nothing matches that" : "The library is empty"}
            body={
              filtered
                ? "Try a different subject or clear the search to see everything."
                : "Upload a lecture recording, a past paper or build a quiz to get your first batch started."
            }
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setSubject("all");
                    setTab("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" icon="upload" onClick={() => setUploading(true)}>
                  Add your first item
                </Button>
              )
            }
          />
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {rows.map((item) => (
            <ContentCard
                key={item.contentId}
                item={item}
                onEditQuiz={(id) => setBuilding({ quizId: id })}
                onSeeResults={setResults}
              />
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-hairline bg-sunken">
                  {["Title", "Subject", "Published", "Reach", "Views", ""].map((h) => (
                    <th key={h} className="eyebrow text-left px-5 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {rows.map((c) => {
                  const chip = CONTENT_CHIP[c.type];
                  return (
                    <tr key={c.contentId} className="hover:bg-ink-50/60 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <IconChip icon={chip.icon} tone={chip.tone} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{c.title}</p>
                            <p className="text-2xs text-ink-500">
                              {c.durationMins ? `${c.durationMins} min` : c.sizeLabel}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-ink-600">{c.subject}</td>
                      <td className="px-5 py-3 text-sm text-ink-600">
                        {formatDate(c.createdAt)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 w-28">
                          <Progress value={c.reachPct} height={5} />
                          <span className="text-2xs font-bold tnum w-8">{c.reachPct}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold tnum">{c.views}</td>
                      <td className="px-5 py-3">
                        <button
                          className="text-ink-400 hover:text-ink-800 transition-colors"
                          aria-label="More actions"
                        >
                          <Icon name="more" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
