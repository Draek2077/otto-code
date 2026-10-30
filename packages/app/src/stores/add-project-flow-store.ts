import { create } from "zustand";
import type { GithubRepositoryChoice } from "@/add-project-flow/model"; // OTTO(bitbucket): reuse the existing generic Git clone composition.

export interface AddProjectFlowRequest {
  id: number;
  preferredHostId?: string;
  repository?: GithubRepositoryChoice; // OTTO(bitbucket): complete remote, never an API credential.
}

interface AddProjectFlowStoreState {
  request: AddProjectFlowRequest | null;
  open: (preferredHostId?: string) => void;
  openRepository: (hostId: string, repository: GithubRepositoryChoice) => void; // OTTO(bitbucket)
  close: () => void;
}

let nextRequestId = 1;

export const useAddProjectFlowStore = create<AddProjectFlowStoreState>((set) => ({
  request: null,
  open: (preferredHostId) => {
    set({
      request: {
        id: nextRequestId++,
        ...(preferredHostId ? { preferredHostId } : {}),
      },
    });
  },
  close: () => set({ request: null }),
  openRepository: (preferredHostId, repository) =>
    set({ request: { id: nextRequestId++, preferredHostId, repository } }), // OTTO(bitbucket)
}));
