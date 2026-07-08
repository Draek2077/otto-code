import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ArtifactMetadata, CreateArtifactInput } from "@otto-code/protocol/artifacts/types";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { artifactsQueryBaseKey } from "@/artifacts/use-artifacts";

export interface CreateArtifactVariables {
  serverId: string;
  input: CreateArtifactInput;
}

export interface UpdateArtifactVariables {
  serverId: string;
  artifactId: string;
  updates: {
    name?: string;
    description?: string;
    projectId?: string;
    provider?: string;
    model?: string;
  };
}

export interface RegenerateArtifactVariables {
  serverId: string;
  artifactId: string;
}

export interface CancelArtifactVariables {
  serverId: string;
  artifactId: string;
}

export interface DeleteArtifactVariables {
  serverId: string;
  artifactId: string;
}

export interface StarArtifactVariables {
  serverId: string;
  artifactId: string;
  starred: boolean;
}

function requireClient(serverId: string) {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    throw new Error("Host is not connected");
  }
  return client;
}

export interface UseArtifactMutationsResult {
  createArtifact: (variables: CreateArtifactVariables) => Promise<ArtifactMetadata>;
  updateArtifact: (variables: UpdateArtifactVariables) => Promise<ArtifactMetadata>;
  regenerateArtifact: (variables: RegenerateArtifactVariables) => Promise<ArtifactMetadata>;
  cancelArtifact: (variables: CancelArtifactVariables) => Promise<ArtifactMetadata>;
  deleteArtifact: (variables: DeleteArtifactVariables) => Promise<void>;
  toggleStar: (variables: StarArtifactVariables) => Promise<ArtifactMetadata>;
  isCreating: boolean;
  isUpdating: boolean;
  isRegenerating: boolean;
  isDeleting: boolean;
}

export function useArtifactMutations(): UseArtifactMutationsResult {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: artifactsQueryBaseKey });
  };

  const createMutation = useMutation({
    mutationFn: async ({ serverId, input }: CreateArtifactVariables): Promise<ArtifactMetadata> => {
      const payload = await requireClient(serverId).artifactCreate({
        name: input.name,
        description: input.description,
        projectId: input.projectId,
        provider: input.provider,
        ...(input.model ? { model: input.model } : {}),
        ...(input.modeId ? { modeId: input.modeId } : {}),
        ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      });
      if (!payload.success) {
        throw new Error(payload.error ?? "Failed to create artifact");
      }
      return payload.artifact;
    },
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      serverId,
      artifactId,
      updates,
    }: UpdateArtifactVariables): Promise<ArtifactMetadata> => {
      const payload = await requireClient(serverId).artifactUpdate({
        artifactId,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.projectId !== undefined ? { projectId: updates.projectId } : {}),
        ...(updates.provider !== undefined ? { provider: updates.provider } : {}),
        ...(updates.model !== undefined ? { model: updates.model } : {}),
      });
      if (!payload.success) {
        throw new Error(payload.error ?? "Failed to update artifact");
      }
      return payload.artifact;
    },
    onSuccess: invalidate,
  });

  const regenerateMutation = useMutation({
    mutationFn: async ({
      serverId,
      artifactId,
    }: RegenerateArtifactVariables): Promise<ArtifactMetadata> => {
      const payload = await requireClient(serverId).artifactRegenerate({ artifactId });
      if (!payload.success) {
        throw new Error(payload.error ?? "Failed to regenerate artifact");
      }
      return payload.artifact;
    },
    onSuccess: invalidate,
  });

  const cancelMutation = useMutation({
    mutationFn: async ({
      serverId,
      artifactId,
    }: CancelArtifactVariables): Promise<ArtifactMetadata> => {
      const payload = await requireClient(serverId).artifactCancel({ artifactId });
      if (!payload.success) {
        throw new Error(payload.error ?? "Failed to cancel artifact generation");
      }
      return payload.artifact;
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ serverId, artifactId }: DeleteArtifactVariables): Promise<void> => {
      const payload = await requireClient(serverId).artifactDelete({ artifactId });
      if (!payload.success) {
        throw new Error(payload.error ?? "Failed to delete artifact");
      }
    },
    onSuccess: invalidate,
  });

  const starMutation = useMutation({
    mutationFn: async ({
      serverId,
      artifactId,
      starred,
    }: StarArtifactVariables): Promise<ArtifactMetadata> => {
      const payload = await requireClient(serverId).artifactStar({ artifactId, starred });
      if (!payload.success) {
        throw new Error(payload.error ?? "Failed to update artifact");
      }
      return payload.artifact;
    },
    onSuccess: invalidate,
  });

  return {
    createArtifact: (variables) => createMutation.mutateAsync(variables),
    updateArtifact: (variables) => updateMutation.mutateAsync(variables),
    regenerateArtifact: (variables) => regenerateMutation.mutateAsync(variables),
    cancelArtifact: (variables) => cancelMutation.mutateAsync(variables),
    deleteArtifact: (variables) => deleteMutation.mutateAsync(variables),
    toggleStar: (variables) => starMutation.mutateAsync(variables),
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isRegenerating: regenerateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
