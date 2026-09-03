import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CONTENT_CHIP,
  IconChip,
  PageHeader,
  Progress,
  SearchInput,
  Select,
  Tabs,
} from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Icon } from "@/components/Icon";
import { relativeTime } from "@/lib/cx";
import { openContentFile, studentApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useDebounced } from "@/lib/useDebounced";

/*
  Student resource list.

  Same underlying content as the teacher library, but the columns a
  student cares about are different: not reach and views, but whether
  they have watched it and how long it takes. Reusing the teacher grid
  here would have been the lazy call and the wrong one.
*/

export default function Resources() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");

  const debounced = useDebounced(query, 250);
  const { data, loading, error, reload } = useApi(
    () => studentApi.library({ subject, q: debounced }),
    [subject, debounced],
  );

  const [busy, setBusy] = useState(null);
  const [openError, setOpenError] = useState(null);

  const open = async (contentId, download) => {
    setBusy(contentId);
    setOpenError(null);
    try {
      await openContentFile(contentId, { download });
      /* The view is recorded server side, so the progress figures on
         this page are stale until it reloads. */
      reload();
    } catch (err) {
      setOpenError(err?.message ?? "That file could not be opened.");
    } finally {
      setBusy(null);
    }
  };

  const all = data ?? [];

  const subjects = useMemo(
    () => [...new Set(all.map((c) => c.subject).filter(Boolean))].sort(),
    [all],
  );

  const rows = useMemo(() => {
    if (tab === "unwatched") return all.filter((c) => c.progress === 0);
    if (tab === "in_progress") return all.filter((c) => c.progress > 0 && c.progress < 100);
    return all;
  }, [all, tab]);

  const counts = {
    all: all.length,
    unwatched: all.filter((c) => c.progress === 0).length,
    in_progress: all.filter((c) => c.progress > 0 && c.progress < 100).length,
  };

  const filtered = subject !== "all" || query !== "";

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="Resources"
        sub="Lectures, notes and past papers shared with your batch."
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search resources"
            className="flex-1 min-w-[200px]"
          />
          <Select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-48">
            <option value="all">All subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          className="px-3"
          items={[
            { value: "all", label: "Everything", count: counts.all },
            { value: "in_progress", label: "Started", count: counts.in_progress },
            { value: "unwatched", label: "Not opened", count: counts.unwatched },
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
            title={filtered ? "Nothing matches that" : "Nothing here yet"}
            body={
              filtered
                ? "Try a different subject or clear the search."
                : "When your teacher publishes a lecture or a paper it shows up on this page."
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
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
        {openError && (
          <p className="flex items-start gap-2 text-xs text-danger-fg bg-danger-bg rounded-[var(--radius-sm)] px-3 py-2.5 mb-4">
            <Icon name="alert" size={14} className="shrink-0 mt-px" />
            {openError}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {rows.map((c) => {
            const chip = CONTENT_CHIP[c.type] ?? CONTENT_CHIP.doc;
            return (
              <Card
                key={c.contentId}
                className="p-4 hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5 transition-all duration-[var(--dur-med)] ease-[var(--ease-out)]"
              >
                <div className="flex items-start gap-3">
                  <IconChip
                    icon={chip.icon}
                    tone={c.progress === 100 ? "success" : chip.tone}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge tone={chip.tone}>{c.type}</Badge>
                      {c.progress === 100 && (
                        <Badge tone="success" icon="check">
                          Done
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold leading-snug line-clamp-2">{c.title}</h3>
                    <p className="text-2xs text-ink-500 mt-1">
                      {c.subject} · {relativeTime(c.createdAt)}
                      {c.durationMins ? ` · ${c.durationMins} min` : ""}
                    </p>
                  </div>
                </div>

                {c.progress > 0 && c.progress < 100 && (
                  <div className="flex items-center gap-2 mt-3">
                    <Progress value={c.progress} height={5} />
                    <span className="text-2xs font-bold tnum text-[var(--portal-accent)]">
                      {c.progress}%
                    </span>
                  </div>
                )}

                {/*
                  Both of these were dead. Opening a file also records
                  the view server side, which is where the teacher's
                  engagement figures come from, so it has to be a
                  request rather than a link.

                  An item with nothing uploaded says so instead of
                  opening an empty tab.
                */}
                <div className="flex items-center gap-2 mt-3.5 pt-3.5 border-t border-hairline">
                  <Button
                    size="sm"
                    variant={c.progress > 0 && c.progress < 100 ? "primary" : "secondary"}
                    icon={c.type === "video" ? "play" : "doc"}
                    className="flex-1"
                    disabled={!c.hasFile}
                    loading={busy === c.contentId}
                    onClick={() => open(c.contentId, false)}
                  >
                    {!c.hasFile
                      ? "Not uploaded yet"
                      : c.progress === 100
                        ? "Watch again"
                        : c.progress > 0
                          ? "Resume"
                          : c.type === "video"
                            ? "Watch"
                            : "Open"}
                  </Button>
                  <button
                    className="size-8 rounded-[var(--radius-sm)] flex items-center justify-center text-ink-500 hover:bg-ink-100 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    aria-label="Download"
                    disabled={!c.hasFile}
                    onClick={() => open(c.contentId, true)}
                  >
                    <Icon name="download" size={15} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
