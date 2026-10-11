import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TopbarSlotValue {
  node: HTMLElement | null;
  setNode: (node: HTMLElement | null) => void;
}

const TopbarSlotContext = createContext<TopbarSlotValue | null>(null);

export function TopbarSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <TopbarSlotContext.Provider value={{ node, setNode }}>
      {children}
    </TopbarSlotContext.Provider>
  );
}

export function TopbarSlotOutlet() {
  const slot = useContext(TopbarSlotContext);
  return <span ref={slot?.setNode} className="flex items-center" />;
}

export function InTopbar({ children }: { children: ReactNode }) {
  const slot = useContext(TopbarSlotContext);
  return slot?.node ? createPortal(children, slot.node) : null;
}
