import { useEffect, useRef, useState } from "react";
import type { Account, Project } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "";

export type BootstrapPayload = {
  user: Account | null;
  accounts: Account[];
  projects: Project[];
};

function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data?.message === "string" ? data.message : "请求失败");
  }
  return data as T;
}

export function useProjects({ notify }: { notify: (message: string) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [bootstrapped, setBootstrapped] = useState(false);
  const skipNextProjectSyncRef = useRef(true);
  const projectSyncTimerRef = useRef<number | null>(null);

  function applyBootstrap(data: BootstrapPayload) {
    setAccounts(data.accounts);
    setCurrentUser(data.user?.username || null);
    setProjects(data.projects);
    skipNextProjectSyncRef.current = true;
  }

  useEffect(() => {
    let alive = true;
    apiRequest<BootstrapPayload>("/api/bootstrap")
      .then((data) => {
        if (!alive) return;
        applyBootstrap(data);
      })
      .catch((error) => {
        if (!alive) return;
        notify(error instanceof Error ? error.message : "后端连接失败");
      })
      .finally(() => {
        if (alive) setBootstrapped(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!bootstrapped || !currentUser) return;
    if (skipNextProjectSyncRef.current) {
      skipNextProjectSyncRef.current = false;
      return;
    }
    if (projectSyncTimerRef.current) window.clearTimeout(projectSyncTimerRef.current);
    projectSyncTimerRef.current = window.setTimeout(() => {
      apiRequest<{ projects: Project[] }>("/api/projects", {
        method: "PUT",
        body: JSON.stringify({ projects }),
      }).catch((error) => {
        notify(error instanceof Error ? error.message : "项目保存失败");
      });
    }, 350);
    return () => {
      if (projectSyncTimerRef.current) window.clearTimeout(projectSyncTimerRef.current);
    };
  }, [bootstrapped, currentUser, projects]);

  return {
    accounts,
    currentUser,
    projects,
    bootstrapped,
    setProjects,
    applyBootstrap,
  };
}
