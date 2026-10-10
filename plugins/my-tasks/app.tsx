import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TasksAppShell } from "./shell/app-shell.js";
import { TasksSidebarAccessory } from "./shell/sidebar-accessory.js";
import { TasksNavigationPanel } from "./shell/navigation-panel.js";
import { TaskDirectiveCard, TaskEmbedPanel } from "./views/embed/index.js";
import { ThreadLinksOverlay } from "./thread-links/dialog.js";
import { openThreadLinks } from "./thread-links/store.js";
import { SplitAttachController } from "./split-attach/controller.js";
import { ThreadLinkedWork } from "./thread-header/linked-work.js";
import { SidebarProjectsTab } from "./sidebar-tab/projects-tab.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "My Tasks",
    icon: "ListTodo",
    path: "tasks",
    component: TasksAppShell,
    experimental_sidebarAccessory: TasksSidebarAccessory,
    fixedTabs: [
      {
        panelId: "tasks",
        id: "navigation",
        title: "Navigation",
        icon: "ListView",
        component: TasksNavigationPanel,
        layout: "flush",
      },
    ],
  });
  app.slots.threadPanelAction({
    id: "task",
    title: "Task",
    icon: "ListTodo",
    component: TaskEmbedPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "linked-work",
    title: "My Tasks work",
    component: ThreadLinkedWork,
    placement: "title",
  });
  app.slots.messageDirective({ id: "my-task", component: TaskDirectiveCard });
  app.slots.experimental_appOverlay({
    id: "thread-links",
    component: ThreadLinksOverlay,
  });
  app.slots.experimental_appOverlay({
    id: "split-attach",
    component: SplitAttachController,
  });
  app.slots.experimental_appOverlay({
    id: "sidebar-projects-tab",
    component: SidebarProjectsTab,
  });
  app.slots.experimental_threadMenuAction({
    id: "attach",
    title: "Attach to My Tasks…",
    icon: "ListTodo",
    run: ({ threadId, projectId }) => {
      openThreadLinks({ threadId, projectId });
    },
  });
});
