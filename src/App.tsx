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
  IconButton,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  ListSubheader,
  Typography,
} from "@mui/material";
import { ArrowBack, Check, Close, Refresh } from "@mui/icons-material";

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

type Entrant = {
  id: number;
  name: string;
  initialSeedNum: number;
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

const SILVER_ENTRANTS_QUERY = `
  query SilverEntrantsQuery($phaseId: ID) {
    phase(id: $phaseId) {
      seeds(query: { page: 1, perPage: 332 }) {
        nodes {
          entrant {
            id
          }
          progressionSource {
            originPhaseGroup {
              displayIdentifier
            }
          }
        }
      }
    }
  }
`;

const SILVER_SETS_QUERY = `
  query SilverSetsQuery($id: ID) {
    phase(id: $id) {
      sets(page: 1, perPage: 142, filters: { hideEmpty: true }) {
        nodes {
          displayScore
          slots {
            entrant {
              id
              name
              initialSeedNum
            }
          }
          winnerId
        }
      }
    }
  }
`;

function getFetchStr(phaseId: number, entrantIds: number[]) {
  return `
    fetch("https://www.start.gg/api/-/rest/phase/${phaseId}", {
      "method": "PUT",
      "headers": {
        "client-version": "20",
        "content-type": "application/json",
      },
      "body": \`{"destPhaseLinks": []}\`
    }).then(() => {
      fetch("https://www.start.gg/api/-/rest/phase/${phaseId}", {
        "method": "PUT",
        "headers": {
          "client-version": "20",
          "content-type": "application/json",
        },
        "body": \`{
          "destPhaseLinks": [{
            "destPhaseId": ${phaseId},
            "maintainMatchup": false,
            "isDefault": false,
            "entrantIds": [
              ${entrantIds.join(", ")}
            ],
            "type": 3,
            "destSeedOrder": 0,
            "destBracketSide": 1,
            "cId": "${phaseId}-1",
            "initialEntrants": {
              ${entrantIds
                .map((entrantId) => `"${entrantId}": true`)
                .join(", ")}
            }
          }]
        }\`
      });
    });
  `;
}

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

  const poolsPhases = useMemo(
    () =>
      phases.filter(
        (phase) =>
          phase.bracketType === "ROUND_ROBIN" &&
          phase.progressions !== null &&
          phase.progressions.length > 0
      ),
    [phases]
  );
  const [poolsPhaseId, setPoolsPhaseId] = useState(0);

  const silverPhases = useMemo(
    () =>
      phases.filter(
        (phase) =>
          phase.bracketType === "SINGLE_ELIMINATION" &&
          phase.progressingInData.length > 0 &&
          phase.progressingInData.every((data) => data.origin === poolsPhaseId)
      ),
    [phases, poolsPhaseId]
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

  const [entrantIdToPoolName, setEntrantIdToPoolName] = useState(
    new Map<number, string>()
  );
  const getEntrantIdToPoolName = useCallback(
    async (phaseId: number) => {
      try {
        setGetting(true);
        const data = await fetchGql(sggApiKey, SILVER_ENTRANTS_QUERY, {
          phaseId,
        });
        setError("");
        const nodes = data?.phase?.seeds?.nodes;
        const newEntrantIdToPoolName = new Map<number, string>();
        if (Array.isArray(nodes)) {
          nodes.forEach((seed) => {
            newEntrantIdToPoolName.set(
              seed.entrant.id,
              seed.progressionSource?.originPhaseGroup?.displayIdentifier ?? ""
            );
          });
        }
        setEntrantIdToPoolName(newEntrantIdToPoolName);
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

  const [silverEntrants, setSilverEntrants] = useState<{
    pending: Entrant[];
    qualified: Entrant[];
  }>({ pending: [], qualified: [] });
  const getSilverEntrants = useCallback(
    async (phaseId: number) => {
      try {
        setGetting(true);
        const data = await fetchGql(sggApiKey, SILVER_SETS_QUERY, {
          id: phaseId,
        });
        setError("");
        const nodes = data?.phase?.sets?.nodes;
        if (Array.isArray(nodes)) {
          const allEntrants = new Map<number, Entrant>();
          const dnqEntrants = new Map<number, Entrant>();
          const lostEntrants = new Map<number, Entrant>();
          nodes.forEach((set) => {
            const { slots } = set;
            if (Array.isArray(slots)) {
              let winnerId: number | null = null;
              if (set.winnerId && set.displayScore) {
                winnerId = set.winnerId;
              }
              slots.forEach((slot) => {
                if (slot.entrant) {
                  allEntrants.set(slot.entrant.id, {
                    id: slot.entrant.id,
                    name: slot.entrant.name,
                    initialSeedNum: slot.entrant.initialSeedNum,
                  });
                  if (winnerId) {
                    if (
                      slot.entrant.id === winnerId &&
                      set.displayScore !== "DQ"
                    ) {
                      dnqEntrants.set(slot.entrant.id, {
                        id: slot.entrant.id,
                        name: slot.entrant.name,
                        initialSeedNum: slot.entrant.initialSeedNum,
                      });
                    } else if (
                      slot.entrant.id !== winnerId &&
                      set.displayScore === "DQ"
                    ) {
                      dnqEntrants.set(slot.entrant.id, {
                        id: slot.entrant.id,
                        name: slot.entrant.name,
                        initialSeedNum: slot.entrant.initialSeedNum,
                      });
                    } else if (
                      slot.entrant.id !== winnerId &&
                      set.displayScore !== "DQ"
                    ) {
                      lostEntrants.set(slot.entrant.id, {
                        id: slot.entrant.id,
                        name: slot.entrant.name,
                        initialSeedNum: slot.entrant.initialSeedNum,
                      });
                    }
                  }
                }
              });
            }
          });
          Array.from(dnqEntrants.keys()).forEach((entrantId) => {
            allEntrants.delete(entrantId);
            lostEntrants.delete(entrantId);
          });
          const qualified = Array.from(lostEntrants.values()).sort(
            (a, b) => a.initialSeedNum - b.initialSeedNum
          );
          qualified.forEach(({ id }) => {
            allEntrants.delete(id);
          });
          setSilverEntrants({
            qualified,
            pending: Array.from(allEntrants.values()).sort(
              (a, b) => a.initialSeedNum - b.initialSeedNum
            ),
          });
        } else {
          setSilverEntrants({ qualified: [], pending: [] });
        }
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

  const [acceptedIds, setAcceptedIds] = useState(new Set<number>());
  const [rejectedIds, setRejectedIds] = useState(new Set<number>());
  const qualified = useMemo(
    () =>
      silverEntrants.qualified.filter(
        (entrant) =>
          !acceptedIds.has(entrant.id) && !rejectedIds.has(entrant.id)
      ),
    [acceptedIds, rejectedIds, silverEntrants.qualified]
  );
  const accepted = useMemo(
    () =>
      silverEntrants.qualified.filter((entrant) => acceptedIds.has(entrant.id)),
    [acceptedIds, silverEntrants.qualified]
  );
  const rejected = useMemo(
    () =>
      silverEntrants.qualified.filter((entrant) => rejectedIds.has(entrant.id)),
    [rejectedIds, silverEntrants.qualified]
  );

  const [copied, setCopied] = useState(false);

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
                  setPoolsPhaseId(0);
                  setSilverPhaseId(0);
                  setEntrantIdToPoolName(new Map());
                  setSilverEntrants({ pending: [], qualified: [] });
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
                      setPoolsPhaseId(0);
                      setSilverPhaseId(0);
                      setEntrantIdToPoolName(new Map());
                      setSilverEntrants({ pending: [], qualified: [] });
                      setBronzePhaseId(0);
                    }}
                  >
                    <ListItemIcon>
                      <ArrowBack />
                    </ListItemIcon>
                    <ListItemText>Event ID: {eventId}</ListItemText>
                  </ListItemButton>
                  {!poolsPhaseId && (
                    <>
                      {poolsPhases.length > 0 && (
                        <List disablePadding>
                          {poolsPhases.map((phase) => (
                            <ListItemButton
                              key={phase.id}
                              onClick={() => {
                                setPoolsPhaseId(phase.id);
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
                  {poolsPhaseId > 0 && (
                    <>
                      <ListItemButton
                        style={{ paddingLeft: 0 }}
                        onClick={() => {
                          setPoolsPhaseId(0);
                          setSilverPhaseId(0);
                          setEntrantIdToPoolName(new Map());
                          setSilverEntrants({ pending: [], qualified: [] });
                          setBronzePhaseId(0);
                        }}
                      >
                        <ListItemIcon>
                          <ArrowBack />
                        </ListItemIcon>
                        <ListItemText>
                          Pools Phase ID: {poolsPhaseId}
                        </ListItemText>
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
                                    getEntrantIdToPoolName(phase.id);
                                    getSilverEntrants(phase.id);
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
                              setEntrantIdToPoolName(new Map());
                              setSilverEntrants({ pending: [], qualified: [] });
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
                              <Stack
                                direction="row"
                                style={{
                                  alignItems: "start",
                                  marginLeft: "-8px",
                                }}
                              >
                                <IconButton
                                  disabled={getting}
                                  style={{ marginTop: "4px" }}
                                  onClick={() => {
                                    getSilverEntrants(silverPhaseId);
                                  }}
                                >
                                  <Refresh />
                                </IconButton>
                                {silverEntrants.pending.length > 0 && (
                                  <List disablePadding>
                                    <ListSubheader>Pending</ListSubheader>
                                    {silverEntrants.pending.map((entrant) => (
                                      <ListItem key={entrant.id}>
                                        <ListItemText>
                                          {entrant.name}
                                        </ListItemText>
                                      </ListItem>
                                    ))}
                                  </List>
                                )}
                                {qualified.length > 0 && (
                                  <List disablePadding>
                                    <ListSubheader>Qualified</ListSubheader>
                                    {qualified.map((entrant) => (
                                      <ListItem key={entrant.id}>
                                        <ListItemText>
                                          {entrant.name}
                                        </ListItemText>
                                        <IconButton
                                          onClick={() => {
                                            const newRejectedIds = new Set(
                                              rejectedIds
                                            );
                                            newRejectedIds.add(entrant.id);
                                            setRejectedIds(newRejectedIds);
                                          }}
                                        >
                                          <Close color="error" />
                                        </IconButton>
                                        <IconButton
                                          onClick={() => {
                                            const newAcceptedIds = new Set(
                                              acceptedIds
                                            );
                                            newAcceptedIds.add(entrant.id);
                                            setAcceptedIds(newAcceptedIds);
                                          }}
                                        >
                                          <Check color="success" />
                                        </IconButton>
                                      </ListItem>
                                    ))}
                                  </List>
                                )}
                                {accepted.length > 0 && (
                                  <List disablePadding>
                                    <ListSubheader>Accepted</ListSubheader>
                                    {accepted.map((entrant) => (
                                      <ListItem key={entrant.id}>
                                        <ListItemText>
                                          {entrantIdToPoolName.get(entrant.id)}{" "}
                                          - {entrant.name}
                                        </ListItemText>
                                        <IconButton
                                          onClick={() => {
                                            const newAcceptedIds = new Set(
                                              acceptedIds
                                            );
                                            newAcceptedIds.delete(entrant.id);
                                            setAcceptedIds(newAcceptedIds);
                                          }}
                                        >
                                          <Close />
                                        </IconButton>
                                      </ListItem>
                                    ))}
                                  </List>
                                )}
                                {rejected.length > 0 && (
                                  <List disablePadding>
                                    <ListSubheader>Rejected</ListSubheader>
                                    {rejected.map((entrant) => (
                                      <ListItem key={entrant.id}>
                                        <ListItemText>
                                          {entrant.name}
                                        </ListItemText>
                                        <IconButton
                                          onClick={() => {
                                            const newRejectedIds = new Set(
                                              rejectedIds
                                            );
                                            newRejectedIds.delete(entrant.id);
                                            setRejectedIds(newRejectedIds);
                                          }}
                                        >
                                          <Close />
                                        </IconButton>
                                      </ListItem>
                                    ))}
                                  </List>
                                )}
                                {silverEntrants.pending.length === 0 &&
                                  qualified.length === 0 &&
                                  accepted.length > 1 && (
                                    <Stack>
                                      <Typography
                                        variant="body2"
                                        style={{ lineHeight: "48px" }}
                                      >
                                        Paste into console on{" "}
                                        <Link
                                          href={`https://www.start.gg/admin/${slug}/bracket-setup`}
                                          target="_blank"
                                          variant="body2"
                                        >
                                          this page
                                        </Link>
                                        .
                                      </Typography>
                                      <Button
                                        disabled={copied}
                                        variant="contained"
                                        style={{ marginTop: "5.75px" }}
                                        onClick={() => {
                                          navigator.clipboard.writeText(
                                            getFetchStr(
                                              bronzePhaseId,
                                              accepted.map(
                                                (entrant) => entrant.id
                                              )
                                            )
                                          );
                                          setCopied(true);
                                          setTimeout(() => {
                                            setCopied(false);
                                          }, 5000);
                                        }}
                                      >
                                        {copied ? "Copied!" : "Copy Fetch"}
                                      </Button>
                                    </Stack>
                                  )}
                              </Stack>
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
        </>
      )}
    </Stack>
  );
}

export default App;
