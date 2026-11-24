import { MarkerType } from "@xyflow/react";
import type { AppNode, Board, CardNodeT, FrameNodeT, Kind, NoteEdge } from "./types";

/** A ready-made architecture-planning board: nested frames, edge labels, markdown, all card types. */
export function sampleBoard(): Pick<Board, "nodes" | "edges"> {
  const card = (id: string, x: number, y: number, kind: Kind, title: string, bullets: string[]): CardNodeT => ({
    id,
    type: "card",
    position: { x, y },
    data: { title, kind, bullets: bullets.join("\n") },
  });
  const frame = (id: string, x: number, y: number, width: number, height: number, title: string, color: number): FrameNodeT => ({
    id,
    type: "frame",
    position: { x, y },
    width,
    height,
    style: { pointerEvents: "none" },
    dragHandle: ".frame-head",
    data: { title, color },
  });
  const edge = (a: string, b: string, label = ""): NoteEdge => ({
    id: `e_${a}_${b}`,
    source: a,
    target: b,
    label: label || undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#7b8494" },
    data: { ghost: false },
  });

  const nodes: AppNode[] = [
    // frames (outer first)
    frame("f_clients", -30, -64, 330, 450, "Clients", 0),
    frame("f_backend", 760, -124, 1210, 760, "Backend platform", 2),
    frame("f_core", 800, -64, 330, 640, "Core services", 1),
    frame("f_data", 1170, -64, 330, 440, "Data", 4),
    frame("f_async", 1540, -64, 330, 440, "Async", 5),

    // clients
    card("mobile", 0, 0, "idea", "Mobile app", ["iOS + Android (**React Native**)", "Browse, order, live-track courier", "- [ ] offline cart"]),
    card("web", 0, 200, "idea", "Web app", ["Same flows as mobile", "Restaurant dashboard under `/partner`", "- [x] auth shared with mobile"]),

    // edge
    card("gateway", 430, 90, "idea", "API Gateway", ["Single entry point", "Rate limiting + request logging", "- [ ] pick gateway: Kong vs. managed"]),

    // core services
    card("auth", 830, 0, "idea", "Auth service", ["JWT access + refresh tokens", "Social login", "Stateless; sessions live in Redis"]),
    card("orders", 830, 200, "idea", "Orders service", ["Order lifecycle: created → paid → delivered", "Owns the orders schema", "Emits `order.created` events"]),
    card("payments", 830, 400, "idea", "Payments service", ["Wraps the payment provider", "Idempotency keys on every charge", "Refunds + partial refunds"]),

    // data
    card("pg", 1200, 0, "note", "Postgres", ["Primary store for orders, users, menus", "Read replica for analytics", "Nightly backups, 30-day retention"]),
    card("redis", 1200, 200, "note", "Redis", ["Session + token cache", "Rate-limit counters", "TTL everything"]),

    // async
    card("queue", 1570, 0, "idea", "Message queue", ["Decouples orders from side effects", "At-least-once delivery", "Dead-letter queue for failures"]),
    card("notify", 1570, 200, "idea", "Notifications", ["Push, SMS, email", "Templates per locale", "Retries with backoff"]),

    // open items
    card("q_provider", 830, 700, "question", "Which payment provider?", ["Stripe vs. Adyen vs. local gateway", "Fees, payout speed, regional coverage", "Decide before building Payments"]),
    card("r_double", 1200, 700, "risk", "Double charges", ["Retry after timeout may charge twice", "Mitigation: idempotency key per order attempt", "Add reconciliation job"]),
    card("t_sla", 1570, 700, "task", "Define delivery SLAs", ["- [ ] target p95 order → confirmation", "- [ ] notification latency budget", "- [ ] write down failure modes"]),
  ];

  const edges: NoteEdge[] = [
    edge("mobile", "gateway", "REST"),
    edge("web", "gateway", "REST"),
    edge("gateway", "auth", "verifies token"),
    edge("gateway", "orders", "routes"),
    edge("orders", "payments", "charges"),
    edge("auth", "redis", "sessions"),
    edge("orders", "pg", "writes"),
    edge("orders", "queue", "emits events"),
    edge("queue", "notify", "consumed by"),
    edge("payments", "q_provider", "undecided"),
    edge("orders", "r_double", "threatened by"),
    edge("notify", "t_sla", "needs"),
  ];
  return { nodes, edges };
}
