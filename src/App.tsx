import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ArrowBack } from "@mui/icons-material";

class ApiError extends Error {
  public fetch: boolean;

  public status?: number;

  public gqlErrors: { message: string }[];

  constructor(e: {
    message: string;
    cause?: unknown;
    fetch?: boolean;
    status?: number;
    gqlErrors?: { message: string }[];
  }) {
    super(e.message, e.cause !== undefined ? { cause: e.cause } : undefined);
    this.fetch = e.fetch ?? false;
    this.status = e.status;
    this.gqlErrors = e.gqlErrors ?? [];
  }
}

async function wrappedFetch(
  input: URL | RequestInfo,
  init?: RequestInit | undefined
) {
  let response: Response | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    response = await fetch(input, init);
    json = await response.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    throw new ApiError({
      cause: e,
      message: "***You may not be connected to the internet***",
      fetch: true,
    });
  }
  if (!response.ok) {
    let keyErr = "";
    if (response.status === 400) {
      keyErr = " ***start.gg API key invalid!***";
    } else if (response.status === 401) {
      keyErr = " ***start.gg API key expired!***";
    }
    throw new ApiError({
      message: keyErr || response.statusText,
      status: response.status,
    });
  }
  return json;
}

type Tournament = {
  name: string;
  slug: string;
};

type Event = {
  id: number;
  name: string;
};

type Phase = {
  id: number;
  name: string;
  bracketType: string;
  progressingInData: {
    origin: number;
  }[];
  progressions:
    | {
        id: number;
      }[]
    | null;
};

async function fetchGql(
  key: string,
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variables: any
) {
  const json = await wrappedFetch("https://api.start.gg/gql/alpha", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (json.errors) {
    throw new ApiError({
      message: json.errors
        .map((error: { message: string }) => error.message)
        .join(", "),
      gqlErrors: json.errors,
    });
  }

  return json.data;
}

const ADMINED_TOURNAMENTS_QUERY = `
  query TournamentsQuery {
    currentUser {
      tournaments(query: {perPage: 50, filter: {tournamentView: "admin"}}) {
        nodes {
          slug
          name
        }
      }
    }
  }
`;

const TOURNAMENT_QUERY = `
  query TournamentQuery($slug: String) {
    tournament(slug: $slug) {
      events {
        id
        name
      }
    }
  }
`;

const EVENT_QUERY = `
  query EventQuery($id: ID) {
    event(id: $id) {
      phases {
        id
        name
        bracketType
        progressingInData {
          origin
        }
        progressions {
          id
        }
      }
    }
  }
`;

function App() {
  const [error, setError] = useState("");
  const [sggApiKey, setSggApiKey] = useState("");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  useEffect(() => {
    (async () => {
      try {
        if (sggApiKey) {
          const data = await fetchGql(sggApiKey, ADMINED_TOURNAMENTS_QUERY, {});
          setError("");
          setTournaments(data.currentUser.tournaments.nodes ?? []);
        }
      } catch (e: unknown) {
        setTournaments([]);
        if (e instanceof Error) {
          setError(e.message);
        }
      }
    })();
  }, [sggApiKey]);

  const [getting, setGetting] = useState(false);
  const [slug, setSlug] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const getTournament = useCallback(
    async (newSlug: string) => {
      try {
        setGetting(true);
        const data = await fetchGql(sggApiKey, TOURNAMENT_QUERY, {
          slug: newSlug,
        });
        setError("");
        setSlug(newSlug);
        const newEvents = data.tournament.events;
        setEvents(newEvents ?? []);
      } catch (e: unknown) {
        if (e instanceof Error) {
          setError(e.message);
        }
      } finally {
        setGetting(false);
      }
    },
    [sggApiKey]
  );

  const [eventId, setEventId] = useState(0);
  const [phases, setPhases] = useState<Phase[]>([]);
  const getEvent = useCallback(
    async (newEventId: number) => {
      try {
        setGetting(true);
        const data = await fetchGql(sggApiKey, EVENT_QUERY, {
          id: newEventId,
        });
        setError("");
        setEventId(newEventId);
        setPhases(data.event.phases ?? []);
      } catch (e: unknown) {
        if (e instanceof Error) {
          setError(e.message);
        }
      } finally {
        setGetting(false);
      }
    },
    [sggApiKey]
  );

  const silverPhases = useMemo(
    () =>
      phases.filter(
        (phase) =>
          phase.bracketType === "SINGLE_ELIMINATION" &&
          phase.progressingInData.length > 0
      ),
    [phases]
  );
  const [silverPhaseId, setSilverPhaseId] = useState(0);

  const bronzePhases = useMemo(
    () =>
      phases.filter(
        (phase) =>
          phase.bracketType === "SINGLE_ELIMINATION" &&
          phase.progressingInData.length === 0
      ),
    [phases]
  );
  const [bronzePhaseId, setBronzePhaseId] = useState(0);

  return (
    <Stack style={{ alignItems: "start" }}>
      {!sggApiKey && (
        <Typography variant="caption" style={{ marginBottom: "8px" }}>
          Get your start.gg API key by clicking “Create new token” in the
          <br />
          “Personal Access Tokens” tab of{" "}
          <Link
            href="https://start.gg/admin/profile/developer"
            target="_blank"
            rel="noreferrer"
          >
            this page
          </Link>
          . Keep it private!
        </Typography>
      )}
      <TextField
        label="start.gg API key"
        size="small"
        type="password"
        variant="outlined"
        value={sggApiKey}
        slotProps={{
          htmlInput: {
            size: 32,
          },
        }}
        onChange={(ev) => {
          setSggApiKey(ev.target.value);
        }}
      />
      {error.length > 0 && <Alert severity="error">{error}</Alert>}

      {sggApiKey && (
        <>
          {!slug && (
            <>
              <form
                style={{
                  alignItems: "center",
                  display: "flex",
                  margin: "8px 4px",
                  gap: "8px",
                }}
                onSubmit={async (event: FormEvent<HTMLFormElement>) => {
                  const target = event.target as typeof event.target & {
                    slug: { value: string };
                  };
                  const newSlug = target.slug.value;
                  event.preventDefault();
                  event.stopPropagation();
                  if (newSlug) {
                    await getTournament(newSlug);
                  }
                }}
              >
                <TextField
                  autoFocus
                  label="Tournament Slug"
                  name="slug"
                  placeholder="super-smash-con-2023"
                  size="small"
                  variant="outlined"
                />
                <Button
                  disabled={getting}
                  endIcon={getting && <CircularProgress size="24px" />}
                  type="submit"
                  variant="contained"
                >
                  Get!
                </Button>
              </form>
              {tournaments.length > 0 &&
                tournaments.map((tournament) => (
                  <ListItemButton
                    key={tournament.slug}
                    disabled={getting}
                    onClick={async () => {
                      await getTournament(tournament.slug);
                    }}
                  >
                    <ListItemText
                      style={{ overflowX: "hidden", whiteSpace: "nowrap" }}
                    >
                      {tournament.name}{" "}
                      <Typography variant="caption">
                        ({tournament.slug})
                      </Typography>
                    </ListItemText>
                  </ListItemButton>
                ))}
            </>
          )}
          {slug && (
            <>
              <ListItemButton
                style={{ paddingLeft: 0 }}
                onClick={() => {
                  setSlug("");
                  setEventId(0);
                  setSilverPhaseId(0);
                  setBronzePhaseId(0);
                }}
              >
                <ListItemIcon>
                  <ArrowBack />
                </ListItemIcon>
                <ListItemText>{slug}</ListItemText>
              </ListItemButton>
              {!eventId && (
                <>
                  {events.length > 0 && (
                    <List disablePadding>
                      {events.map((event) => (
                        <ListItemButton
                          key={event.id}
                          disabled={getting}
                          onClick={async () => {
                            await getEvent(event.id);
                          }}
                        >
                          <ListItemText
                            style={{
                              overflowX: "hidden",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {event.name}{" "}
                            <Typography variant="caption">
                              ({event.id})
                            </Typography>
                          </ListItemText>
                        </ListItemButton>
                      ))}
                    </List>
                  )}
                </>
              )}
              {eventId > 0 && (
                <>
                  <ListItemButton
                    style={{ paddingLeft: 0 }}
                    onClick={() => {
                      setEventId(0);
                      setSilverPhaseId(0);
                      setBronzePhaseId(0);
                    }}
                  >
                    <ListItemIcon>
                      <ArrowBack />
                    </ListItemIcon>
                    <ListItemText>Event ID: {eventId}</ListItemText>
                  </ListItemButton>
                  {!silverPhaseId && (
                    <>
                      {silverPhases.length > 0 && (
                        <List disablePadding>
                          {silverPhases.map((phase) => (
                            <ListItemButton
                              key={phase.id}
                              onClick={() => {
                                setSilverPhaseId(phase.id);
                              }}
                            >
                              <ListItemText
                                style={{
                                  overflowX: "hidden",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {phase.name}{" "}
                                <Typography variant="caption">
                                  ({phase.id})
                                </Typography>
                              </ListItemText>
                            </ListItemButton>
                          ))}
                        </List>
                      )}
                    </>
                  )}
                  {silverPhaseId > 0 && (
                    <>
                      <ListItemButton
                        style={{ paddingLeft: 0 }}
                        onClick={() => {
                          setSilverPhaseId(0);
                          setBronzePhaseId(0);
                        }}
                      >
                        <ListItemIcon>
                          <ArrowBack />
                        </ListItemIcon>
                        <ListItemText>
                          Silver Phase ID: {silverPhaseId}
                        </ListItemText>
                      </ListItemButton>
                      {!bronzePhaseId && (
                        <>
                          {bronzePhases.length > 0 && (
                            <List disablePadding>
                              {bronzePhases.map((phase) => (
                                <ListItemButton
                                  key={phase.id}
                                  onClick={() => {
                                    setBronzePhaseId(phase.id);
                                  }}
                                >
                                  <ListItemText
                                    style={{
                                      overflowX: "hidden",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {phase.name}{" "}
                                    <Typography variant="caption">
                                      ({phase.id})
                                    </Typography>
                                  </ListItemText>
                                </ListItemButton>
                              ))}
                            </List>
                          )}
                        </>
                      )}
                      {bronzePhaseId > 0 && (
                        <>
                          <ListItemButton
                            style={{ paddingLeft: 0 }}
                            onClick={() => {
                              setBronzePhaseId(0);
                            }}
                          >
                            <ListItemIcon>
                              <ArrowBack />
                            </ListItemIcon>
                            <ListItemText>
                              Bronze Phase ID: {bronzePhaseId}
                            </ListItemText>
                          </ListItemButton>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </Stack>
  );
}

export default App;
