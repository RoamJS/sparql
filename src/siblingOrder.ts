export type SiblingEntry = {
  uid: string;
  existing: boolean;
  retained: boolean;
  header: boolean;
};
type Link = { uid: string; previous?: Link; next?: Link };

// Plan the final order with links, then count live predecessors while replaying
// insertions. This avoids repeatedly copying or scanning large sibling arrays.
export const insertionOrders = ({
  siblings,
  entries,
}: {
  siblings: string[];
  entries: SiblingEntry[];
}): Map<string, number> => {
  const head: Link = { uid: "" };
  const tail: Link = { uid: "" };
  head.next = tail;
  tail.previous = head;
  const links = new Map<string, Link>();
  const insertBefore = (link: Link, following: Link): void => {
    link.previous = following.previous;
    link.next = following;
    following.previous!.next = link;
    following.previous = link;
    links.set(link.uid, link);
  };
  siblings.forEach((uid) => insertBefore({ uid }, tail));
  const following = new Array<string | undefined>(entries.length);
  let next: string | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    following[i] = next;
    if (entries[i].existing && !entries[i].retained) next = entries[i].uid;
  }
  let preceding: Link | undefined;
  entries.forEach((entry, index) => {
    if (entry.retained) return;
    if (entry.existing) {
      preceding = links.get(entry.uid);
      return;
    }
    const anchor = following[index];
    const before = entry.header
      ? head.next!
      : (anchor && links.get(anchor)) || preceding?.next || tail;
    const link = { uid: entry.uid };
    insertBefore(link, before);
    preceding = link;
  });
  const positions = new Map<string, number>();
  for (
    let link: Link | undefined = head.next;
    link && link !== tail;
    link = link.next
  )
    positions.set(link.uid, positions.size + 1);
  const counts = new Array<number>(positions.size + 1).fill(0);
  const activate = (index: number): void => {
    for (let i = index; i < counts.length; i += i & -i) counts[i]++;
  };
  siblings.forEach((uid) => activate(positions.get(uid)!));
  const orders = new Map<string, number>();
  entries.forEach((entry) => {
    if (entry.existing || entry.retained) return;
    const index = positions.get(entry.uid)!;
    let order = 0;
    for (let i = index - 1; i > 0; i -= i & -i) order += counts[i];
    orders.set(entry.uid, order);
    activate(index);
  });
  return orders;
};
