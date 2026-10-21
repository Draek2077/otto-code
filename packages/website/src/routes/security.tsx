import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/security")({
  head: () =>
    pageMeta(
      "Security Policy & Responsibility Disclaimer - Otto",
      "Otto's security policy and responsibility disclaimer: local-first security principles, end-to-end encryption, user responsibilities, and how to report vulnerabilities.",
      "/security",
    ),
  component: Security,
});

function Security() {
  return (
    <SiteShell width="default">
      <h1 className="text-3xl font-medium mb-8">Security Policy &amp; Responsibility Disclaimer</h1>

      <div className="space-y-6 text-white/70 leading-relaxed">
        <p>
          Otto is designed from the ground up with local-first security principles, end-to-end
          encryption, and sandboxing considerations in mind. However, because Otto runs locally
          within your infrastructure,{" "}
          <strong className="text-white">
            you are the ultimate administrator of your environment.
          </strong>
        </p>
        <p>
          This policy outlines where our code boundaries end and where your responsibilities as a
          user begin. By using Otto, you acknowledge that you are running this software at your own
          discretion and risk.
        </p>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">
            1. No assumption of automated data protection
          </h2>
          <p>
            While Otto utilizes strong cryptographic protocols (such as ECDH key exchanges and
            XSalsa20-Poly1305 authenticated encryption for relay connections),{" "}
            <strong className="text-white">
              the software does not assume to automatically protect your data against host-level or
              network-level vulnerabilities.
            </strong>
          </p>
          <p>
            Otto executes agents within your local user context. If your host machine, local
            network, API keys, or Docker configurations are insecure, Otto cannot protect your
            environment from the consequences of those vulnerabilities.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">
            2. User responsibility &amp; discretion
          </h2>
          <p>
            You are entirely responsible for configuring, maintaining, and securing the environment
            in which the Otto daemon runs. To ensure your deployment remains secure, you are
            required to understand and implement the security measures detailed across our{" "}
            <a href="/docs/security" className="underline hover:text-white/90">
              Security Documentation
            </a>
            .
          </p>
          <p>Critical configuration responsibilities include, but are not limited to:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              <strong className="text-white">Network binding:</strong> Understanding the risks of
              binding to <code className="text-white/90">0.0.0.0</code>. Never exposing the daemon
              to a network interface without enabling robust password authentication.
            </li>
            <li>
              <strong className="text-white">Credential isolation:</strong> Properly scoping Docker
              workspace mounts and protecting the state directories (like{" "}
              <code className="text-white/90">/home/otto</code> or{" "}
              <code className="text-white/90">~/.claude/</code>) that contain your sensitive
              provider credentials.
            </li>
            <li>
              <strong className="text-white">Secret management:</strong> Treating QR codes, pairing
              links, and daemon private keys as highly confidential passwords. Anyone with access to
              a pairing token can control your local agents.
            </li>
            <li>
              <strong className="text-white">Network traffic:</strong> Leveraging secure network
              wrappers like Tailscale or private VPNs if you choose to bypass the end-to-end
              encrypted relay for direct connections.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">
            3. Limitation of liability (&quot;as-is&quot; clause)
          </h2>
          <p>
            <strong className="text-white">
              We are not responsible for anything you or your agents do.
            </strong>
          </p>
          <p>
            Otto is open-source software provided on an &quot;AS IS&quot; basis, without warranty of
            any kind, express or implied. Under no circumstances shall the authors, maintainers, or
            contributors be held liable for any claim, damages, or other liability, whether in an
            action of contract, tort, or otherwise, arising from, out of, or in connection with:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Unauthorized access to your local daemon or host system.</li>
            <li>
              Code generation, file system modifications, or terminal commands executed by your
              agents.
            </li>
            <li>
              Data leaks resulting from compromised host environments, public Wi-Fi exposure, or
              insecure reverse proxies.
            </li>
            <li>Loss of data, system downtime, or financial loss stemming from software usage.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">4. Updates and patches</h2>
          <p>
            Security is an ongoing process. Maintainers regularly release updates to address
            underlying software dependencies, patch bugs, and optimize encryption pipelines.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              It is your responsibility to keep your Otto daemon, CLI, and associated Docker
              containers updated to the latest stable versions.
            </li>
            <li>Running outdated software increases your exposure to known vulnerabilities.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-medium text-white">Reporting a security vulnerability</h2>
          <p>
            If you discover a security vulnerability within the core architecture of Otto, please{" "}
            <strong className="text-white">do not</strong> open a public GitHub issue. To allow us
            to investigate and patch the issue safely, please report it directly through our private
            security channels:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              <strong className="text-white">Private advisory:</strong> Open a{" "}
              <a
                href="https://github.com/Draek2077/otto-code/security/advisories/new"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white/90"
              >
                GitHub Security Advisory
              </a>{" "}
              on the repository.
            </li>
            <li>
              <strong className="text-white">Expected response:</strong> We aim to review all
              security advisories within 7 days and coordinate a patch responsibly.
            </li>
          </ul>
        </section>

        <p className="text-sm text-white/50 pt-6">Last updated: July 2026</p>
      </div>
    </SiteShell>
  );
}
