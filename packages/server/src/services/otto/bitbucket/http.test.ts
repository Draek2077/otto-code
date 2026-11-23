import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createBitbucketHttp } from "./http.js";

describe("Bitbucket credential-bound transport", () => {
  it("refuses a foreign pagination destination before forwarding credentials", async () => {
    const requests: string[] = [];
    const http = createBitbucketHttp({
      credential: { revision: "1", email: "test@example.test", apiToken: "private" },
      fetch: async (url) => {
        requests.push(String(url));
        return Response.json({
          values: [{ id: 1 }],
          next: "https://other.example/2.0/repositories/team/repo/pullrequests?page=2",
        });
      },
    });
    await expect(
      http.page("/2.0/repositories/team/repo/pullrequests", z.object({ id: z.number() })),
    ).rejects.toThrow("unsafe API destination");
    expect(requests).toEqual(["https://api.bitbucket.org/2.0/repositories/team/repo/pullrequests"]);
  });
});
