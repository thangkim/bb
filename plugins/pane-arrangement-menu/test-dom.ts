function icon(name: string): HTMLElement {
  const element = document.createElement("span");
  element.dataset.iconRoot = "";
  element.dataset.icon = name;
  return element;
}

export function mountPane(
  paneId: string,
  options: { ariaLabel?: string; fullScreen?: boolean } = {},
) {
  const pane = document.createElement("div");
  pane.dataset.splitPaneId = paneId;
  const header = document.createElement("header");
  const trigger = document.createElement("button");
  trigger.id = `trigger-${paneId}`;
  trigger.setAttribute("aria-label", "Thread actions");
  const actions = document.createElement("div");
  actions.dataset.threadHeaderPaneActions = "";
  const button = document.createElement("button");
  const fullScreen = options.fullScreen ?? false;
  button.setAttribute(
    "aria-label",
    options.ariaLabel ??
      (fullScreen ? "Exit Full Screen (⇧⌘E)" : "Full Screen (⇧⌘E)"),
  );
  button.setAttribute("aria-pressed", String(fullScreen));
  button.append(icon(fullScreen ? "Minimize2" : "Maximize2"));
  const close = document.createElement("button");
  close.setAttribute("aria-label", "Close pane");
  actions.append(button, close);
  header.append(trigger, actions);
  pane.append(header);
  document.body.append(pane);
  return { pane, trigger, button, close };
}

function menuItem(title: string, iconName: string): HTMLElement {
  const item = document.createElement("div");
  item.setAttribute("role", "menuitem");
  item.className = "flex";
  item.append(icon(iconName), document.createTextNode(title));
  return item;
}

export function mountMenu(triggerId: string | null, titles: string[]) {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  if (triggerId !== null) menu.setAttribute("aria-labelledby", triggerId);
  const items = titles.map((title) => menuItem(title, "Maximize2"));
  menu.append(menuItem("Rename", "Edit"), ...items);
  const portal = document.createElement("div");
  portal.append(menu);
  document.body.append(portal);
  return { portal, items };
}
