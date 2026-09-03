import { useCallback, useEffect, useRef, useState } from "react";

/*
  Data fetching hook.

  Deliberately small. The screens need four things and nothing more:
  data, a loading flag, a typed error, and a way to refetch. Anything
  larger (a cache, query keys, background revalidation) is a real
  library's job, and adding a half version of one here would be worse
  than either option.

  Requests are aborted on unmount and superseded when the inputs change,
  so a slow response cannot overwrite a newer one.
*/
export function useApi(fetcher, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({
    data: null,
    loading: !skip,
    error: null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Bumped to invalidate in flight responses from a previous run.
  const runIdRef = useRef(0);

  const run = useCallback(async () => {
    if (skip) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const runId = ++runIdRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      if (runId === runIdRef.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (runId === runIdRef.current) setState({ data: null, loading: false, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, ...deps]);

  useEffect(() => {
    run();
    return () => {
      // Any response still in flight belongs to a stale run.
      runIdRef.current++;
    };
  }, [run]);

  return { ...state, reload: run };
}

/*
  Mutation helper. Same reasoning as above: the screens need a pending
  flag, an error and a runner, so that is all this is.
*/
export function useMutation(mutator) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const mutate = useCallback(
    async (...args) => {
      setPending(true);
      setError(null);
      try {
        return await mutator(...args);
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [mutator],
  );

  return { mutate, pending, error };
}
