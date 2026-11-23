import { describe, expect, it } from "vitest";
import { chatterChoices, defaultChatter } from "./chat-choices";
const roster = ["Amy", "Bo", "Cy"].map((name, i) => ({
  id: name,
  name,
  provider: "mock",
  roles: i === 2 ? ["writer"] : ["chatter"],
}));
describe("chat Profile choices", () => {
  it("uses Team member order before the last explicit choice", () => {
    const team = { id: "t", name: "T", memberIds: ["Cy", "Bo", "Amy"] };
    expect(defaultChatter(team, roster, "Amy")?.id).toBe("Bo");
    expect(chatterChoices(team, roster).choices.map((p) => p.id)).toEqual(["Bo", "Amy"]);
  });
  it("uses the host's remembered eligible Chatter when a Team has no available holder", () => {
    const team = { id: "t", name: "T", memberIds: ["absent", "Cy"] };
    expect(defaultChatter(team, roster, "Bo")?.id).toBe("Bo");
    expect(defaultChatter(undefined, roster, "absent")?.id).toBe("Amy");
    expect(defaultChatter(team, roster.slice(2))).toBeUndefined();
  });
});
