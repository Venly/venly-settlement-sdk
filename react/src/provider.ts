import {
  createContext,
  createElement,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  FundflowClient,
  VenlyFinanceClient,
  type FundflowClientOptions,
  type VenlyFinanceClientOptions,
} from "@venlyfinance/sdk";

/**
 * Environments the provider accepts. "mock" constructs both clients with
 * zero credentials and zero network (the SDK's stateful fixture store);
 * "staging" and "production" require credentials or pre-built clients.
 */
export type VenlyReactEnvironment = "mock" | "staging" | "production";

/** The pair of configured API clients every hook resolves from context. */
export interface VenlyClients {
  environment: VenlyReactEnvironment;
  finance: VenlyFinanceClient;
  fundflow: FundflowClient;
}

const VenlyContext = createContext<VenlyClients | null>(null);

export interface VenlyProviderProps {
  /**
   * Default "mock": zero credentials, zero network, seeded fixtures. The
   * same component tree flips to staging/production by changing this prop
   * and supplying credentials server-side or a proxy.
   */
  environment?: VenlyReactEnvironment;
  /**
   * OAuth2 client-credentials. SERVER-SIDE ONLY (React Server Components,
   * route handlers, tests). The provider throws if a secret reaches a
   * browser bundle outside mock mode: a leaked clientSecret is full API
   * access. For browser apps use `proxyClientOptions()` and keep the
   * credentials behind your own backend.
   */
  clientId?: string;
  clientSecret?: string;
  /** Pre-built clients (win over environment/credentials/options). */
  finance?: VenlyFinanceClient;
  fundflow?: FundflowClient;
  /** Full per-client options, e.g. from `proxyClientOptions()`. */
  financeOptions?: VenlyFinanceClientOptions;
  fundflowOptions?: FundflowClientOptions;
  /**
   * Reuse the app's QueryClient. When omitted a private one is created with
   * retry disabled: the SDK already retries transient failures (429/5xx
   * with backoff), and stacking a second retry layer multiplies latency.
   */
  queryClient?: QueryClient;
  children?: ReactNode;
}

function buildClients(props: VenlyProviderProps): VenlyClients {
  const environment = props.environment ?? "mock";

  if (
    environment !== "mock" &&
    props.clientSecret &&
    typeof window !== "undefined"
  ) {
    throw new Error(
      "[@venlyfinance/react] Refusing to construct a credentialed client in the browser: " +
        "a bundled clientSecret is full API access for anyone who opens devtools. " +
        "Keep credentials behind your backend and pass proxyClientOptions(), " +
        "or build the clients in server code and pass them via the `finance`/`fundflow` props.",
    );
  }

  const finance =
    props.finance ??
    new VenlyFinanceClient(
      props.financeOptions ??
        (environment === "mock"
          ? { environment: "mock" }
          : {
              environment,
              clientId: requireCredential(props.clientId, "clientId"),
              clientSecret: requireCredential(props.clientSecret, "clientSecret"),
            }),
    );

  const fundflow =
    props.fundflow ??
    new FundflowClient(
      props.fundflowOptions ??
        (environment === "mock"
          ? { environment: "mock" }
          : {
              environment,
              clientId: requireCredential(props.clientId, "clientId"),
              clientSecret: requireCredential(props.clientSecret, "clientSecret"),
            }),
    );

  return { environment, finance, fundflow };
}

function requireCredential(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `[@venlyfinance/react] environment is not "mock" but no ${name} was provided. ` +
        "Pass credentials (server-side only), proxyClientOptions(), or pre-built clients.",
    );
  }
  return value;
}

/**
 * Context provider for every hook in this package.
 *
 * ```tsx
 * <VenlyProvider environment="mock">
 *   <App />
 * </VenlyProvider>
 * ```
 */
export function VenlyProvider(props: VenlyProviderProps) {
  // Clients and the fallback QueryClient are constructed exactly once per
  // provider instance; changing construction props requires a remount (key=).
  const [clients] = useState(() => buildClients(props));
  const [queryClient] = useState(
    () =>
      props.queryClient ??
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 5_000, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );

  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(VenlyContext.Provider, { value: clients }, props.children),
  );
}

/** The configured clients. Throws outside a `<VenlyProvider>`. */
export function useVenly(): VenlyClients {
  const clients = useContext(VenlyContext);
  if (!clients) {
    throw new Error(
      "[@venlyfinance/react] useVenly() called outside <VenlyProvider>. " +
        "Wrap your tree in <VenlyProvider environment=\"mock\"> to get started.",
    );
  }
  return clients;
}

/**
 * Mock controls (call log, failNext, lifecycle advancement). Defined only
 * when the provider runs with environment "mock"; both fields are undefined
 * otherwise, so demo/test affordances can never fire against live money.
 */
export function useVenlyMock() {
  const { finance, fundflow } = useVenly();
  return { finance: finance.mock, fundflow: fundflow.mock };
}
