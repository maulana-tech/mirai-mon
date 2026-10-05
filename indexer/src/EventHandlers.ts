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
    amount: undefined,
    saved: undefined,
    shares: undefined,
    bps: undefined,
    until: undefined,
    strategy: undefined,
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
      lockUntil: undefined,
      strategy: undefined,
    }
  );
}

indexer.onEvent({ contract: "Mirai", event: "PaymentRouted" }, async ({ event, context }) => {
  const { from, to, amount, savingsAmount, shares } = event.params;
  context.Activity.set({ ...base(event, to), kind: "pay", from: lc(from), amount, saved: savingsAmount, shares });

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

indexer.onEvent({ contract: "Mirai", event: "SavingsWithdrawn" }, async ({ event, context }) => {
  const { user, shares, amountOut } = event.params;
  context.Activity.set({ ...base(event, user), kind: "wd_save", shares, amount: amountOut });
  const s = await saver(context, user);
  context.Saver.set({ ...s, totalWithdrawn: s.totalWithdrawn + amountOut });
});

indexer.onEvent({ contract: "Mirai", event: "SplitSet" }, async ({ event, context }) => {
  const { user, bps } = event.params;
  context.Activity.set({ ...base(event, user), kind: "split", bps: Number(bps) });
  const s = await saver(context, user);
  context.Saver.set({ ...s, splitBps: Number(bps) });
});

indexer.onEvent({ contract: "Mirai", event: "LockSet" }, async ({ event, context }) => {
  const { user, until } = event.params;
  context.Activity.set({ ...base(event, user), kind: "lock", until });
  const s = await saver(context, user);
  context.Saver.set({ ...s, lockUntil: until });
});

indexer.onEvent({ contract: "Mirai", event: "StrategySet" }, async ({ event, context }) => {
  const { user, strategy, moved } = event.params;
  context.Activity.set({ ...base(event, user), kind: "strategy", strategy: Number(strategy), amount: moved });
  const s = await saver(context, user);
  context.Saver.set({ ...s, strategy: Number(strategy) });
});
