import { indexer, type EvmOnEventContext, type Saver } from "envio";


// Addresses are stored lowercase so the web app can filter with a plain equality.
const lc = (a: string) => a.toLowerCase();

type EventMeta = {
  chainId: number;
  logIndex: number;
  block: { number: number; timestamp: number };
  transaction: { hash: string };
};

function base(event: EventMeta, user: string) {
  return {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: lc(user),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    from: undefined,
    to: undefined,
    amount: undefined,
    saved: undefined,
    shares: undefined,
    bps: undefined,
    until: undefined,
    strategy: undefined,
    pocket: undefined,
    custom: undefined,
    weights: undefined,
  };
}

async function saver(context: EvmOnEventContext, user: string): Promise<Saver> {
  const id = lc(user);
  return (
    (await context.Saver.get(id)) ?? {
      id,
      totalReceived: 0n,
      totalSaved: 0n,
      totalWithdrawn: 0n,
      payments: 0,
      splitBps: undefined,
    }
  );
}

indexer.onEvent({ contract: "Mirai", event: "PaymentRouted" }, async ({ event, context }) => {
  const { from, to, amount, savingsAmount, shares } = event.params;
  context.Activity.set({ ...base(event, to), kind: "pay", from: lc(from), amount, saved: savingsAmount, shares });
  // The payer sees the money leave too (a self-payment is just the "pay" row).
  if (lc(from) !== lc(to)) {
    const sent = base(event, from);
    context.Activity.set({ ...sent, id: `${sent.id}_sent`, kind: "sent", to: lc(to), amount });
  }

  const s = await saver(context, to);
  context.Saver.set({
    ...s,
    totalReceived: s.totalReceived + amount,
    totalSaved: s.totalSaved + savingsAmount,
    payments: s.payments + 1,
  });

  const p = (await context.Protocol.get("mirai")) ?? { id: "mirai", volume: 0n, saved: 0n, payments: 0, savers: 0 };
  context.Protocol.set({
    ...p,
    volume: p.volume + amount,
    saved: p.saved + savingsAmount,
    payments: p.payments + 1,
    savers: p.savers + (s.payments === 0 ? 1 : 0),
  });
});

indexer.onEvent({ contract: "Mirai", event: "SpendWithdrawn" }, async ({ event, context }) => {
  const { user, amount } = event.params;
  context.Activity.set({ ...base(event, user), kind: "wd_spend", amount });
  const s = await saver(context, user);
  context.Saver.set({ ...s, totalWithdrawn: s.totalWithdrawn + amount });
});

/** Adds `delta` to a pocket's net deposits (never below zero: growth withdrawn first is still growth). */
async function addFlow(context: EvmOnEventContext, user: string, pocket: bigint, delta: bigint, reset = false) {
  const id = `${lc(user)}_${pocket}`;
  const prev = reset ? 0n : ((await context.PocketFlow.get(id))?.deposited ?? 0n);
  const next = prev + delta;
  context.PocketFlow.set({ id, user: lc(user), pocket: Number(pocket), deposited: next > 0n ? next : 0n });
  return prev;
}

indexer.onEvent({ contract: "Mirai", event: "PocketFunded" }, async ({ event, context }) => {
  const { user, pocket, amount } = event.params;
  await addFlow(context, user, pocket, amount);
});

indexer.onEvent({ contract: "Mirai", event: "PocketWithdrawn" }, async ({ event, context }) => {
  const { user, pocket, amount } = event.params;
  context.Activity.set({ ...base(event, user), kind: "wd_save", pocket: Number(pocket), amount });
  await addFlow(context, user, pocket, -amount);
  const s = await saver(context, user);
  context.Saver.set({ ...s, totalWithdrawn: s.totalWithdrawn + amount });
});

indexer.onEvent({ contract: "Mirai", event: "PocketCreated" }, async ({ event, context }) => {
  const { user, pocket, strategy } = event.params;
  // pocket 0 is the default one, opened implicitly on first use: no feed row; a reused slot starts empty
  if (pocket !== 0n)
    context.Activity.set({ ...base(event, user), kind: "pocket_new", pocket: Number(pocket), strategy: Number(strategy) });
  await addFlow(context, user, pocket, 0n, true);
});

indexer.onEvent({ contract: "Mirai", event: "PocketClosed" }, async ({ event, context }) => {
  const { user, pocket, into, moved } = event.params;
  context.Activity.set({ ...base(event, user), kind: "pocket_close", pocket: Number(pocket), amount: moved });
  // the closed pocket's deposits travel with its money
  const carried = await addFlow(context, user, pocket, 0n, true);
  await addFlow(context, user, into, carried);
});

indexer.onEvent({ contract: "Mirai", event: "PocketLockSet" }, async ({ event, context }) => {
  const { user, pocket, until } = event.params;
  context.Activity.set({ ...base(event, user), kind: "lock", pocket: Number(pocket), until });
});

indexer.onEvent({ contract: "Mirai", event: "PocketStrategySet" }, async ({ event, context }) => {
  const { user, pocket, strategy, moved } = event.params;
  context.Activity.set({
    ...base(event, user),
    kind: "strategy",
    pocket: Number(pocket),
    strategy: Number(strategy),
    amount: moved,
  });
});

indexer.onEvent({ contract: "Mirai", event: "SplitSet" }, async ({ event, context }) => {
  const { user, bps } = event.params;
  context.Activity.set({ ...base(event, user), kind: "split", bps: Number(bps) });
  const s = await saver(context, user);
  context.Saver.set({ ...s, splitBps: Number(bps) });
});

indexer.onEvent({ contract: "BasketVault", event: "WeightsSet" }, async ({ event, context }) => {
  const { user, pocket, custom, weights } = event.params;
  context.Activity.set({
    ...base(event, user),
    kind: "basket",
    pocket: Number(pocket),
    custom,
    weights: weights.map(Number),
  });
});
