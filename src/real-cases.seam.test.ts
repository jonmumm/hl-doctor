// Real testnet txs found with scripts/find-cases.ts, and the exact findings hl-doctor gives for each.
// Re-record against the live APIs with: HL_RECORD=1 pnpm vitest run src/real-cases.seam.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "./main.ts";
import { startReplayServer, type ReplayServer } from "./replay-server.ts";
import type { Finding } from "./types.ts";

let server: ReplayServer;

beforeAll(async () => {
  server = await startReplayServer(new URL("./__fixtures__/real-cases.json", import.meta.url).pathname);
});
afterAll(async () => {
  await server.close();
  expect(server.misses).toEqual([]);
});

const diagnose = async (hash: string) => {
  const out: string[] = [];
  const code = await run([hash, "--json"], { out: (s) => out.push(s), err: () => {}, color: false }, server.endpoints);
  const report: unknown = JSON.parse(out.join("\n"));
  return { code, report };
};

const expectFindings = async (hash: string, findings: Finding[], code: number) => {
  expect(await diagnose(hash)).toEqual({ code, report: { target: hash, network: "testnet", sections: [{ heading: "HyperCore effect", findings }] } });
};

describe("real testnet transactions", () => {
  it("a CoreWriter limit order that filled", async () => {
    await expectFindings("0x48c46a37c230dcfde8008a9d22e6e161b7f7330756a669f976fcb85d051377fe", [{ severity: "ok", title: "ETH order filled", detail: "oid 63823780855" }], 0);
  });

  it("a CoreWriter sendAsset of USDC that landed", async () => {
    await expectFindings(
      "0x87f4266fb14f1c6c35f4e354d2c85b573400eb5df356f83a80ae6d6e4e4f9b2f",
      [
        {
          severity: "ok",
          title: "sendAsset: landed on HyperCore (send)",
          detail:
            "sendAsset(destination=0x41fFeF9f0598483F467C9aD6F355b6494B1053B3 subAccount=0x0000000000000000000000000000000000000000 sourceDex=0 destinationDex=0 token=0 amountWei=2000000000)",
        },
      ],
      0,
    );
  });

  it("a CoreWriter spotSend to the HYPE system address that landed", async () => {
    await expectFindings(
      "0x91a43912379a430ff18c7d03bd277e790cdf5694a53ca8156984bbda73c745ab",
      [
        {
          severity: "ok",
          title: "spotSend: landed on HyperCore (spotTransfer)",
          detail: "spotSend(destination=0x2222222222222222222222222222222222222222 token=1105 wei=459885561)",
        },
      ],
      0,
    );
  });

  it("HYPE sent from HyperEVM to 0x2222… that reached HyperCore", async () => {
    await expectFindings("0x9f4dd8a29f37049f3d1fcb73c151c99679eabdc56985ff140bb8c4064e6080c3", [{ severity: "ok", title: "6.5753898 HYPE reached HyperCore (no escrow)" }], 0);
  });

  it("a token bridged to its 0x20… system address, then sent on with sendAsset in the same tx", async () => {
    await expectFindings(
      "0x6aa11f168c07ac290a1593136ede20ddc04f347eea94cc1ada3cf72f2cca7e48",
      [
        { severity: "ok", title: "19800000 of token 0 (raw units) reached HyperCore (no escrow)" },
        {
          severity: "ok",
          title: "sendAsset: landed on HyperCore (spotTransfer)",
          detail:
            "sendAsset(destination=0xbC7A29d057B66C76438459D85E2b92E830b808Fa subAccount=0x0000000000000000000000000000000000000000 sourceDex=4294967295 destinationDex=0 token=0 amountWei=1980000000)",
        },
      ],
      0,
    );
  });

  it("a CoreWriter action id the docs don't list (14) is reported as undecodable", async () => {
    await expectFindings(
      "0xd348e5e1c6196b7d1f84d367d267dfb19ebeb1e40607cfbdfee969989788dc49",
      [{ severity: "error", title: "CoreWriter action 14 could not be decoded", detail: "unknown action id 14" }],
      1,
    );
  });
});
