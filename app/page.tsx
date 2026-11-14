import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleCheck,
  Database,
  FileSearch,
  FileSpreadsheet,
  History,
  Landmark,
  LockKeyhole,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WalletCards,
  Zap,
} from "lucide-react";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Veyra — AI treasury operations on NEAR",
  description: "Turn a spreadsheet into policy-protected bulk payments with AI review, autonomous settlement, failure recovery, and a complete on-chain audit trail.",
};

const workflow = [
  { number: "01", icon: FileSpreadsheet, title: "Upload the run", copy: "Bring a CSV or Excel file with recipients, amounts, tokens, and payment context." },
  { number: "02", icon: BrainCircuit, title: "Let the agent investigate", copy: "Veyra checks accounts, duplicates, limits, token support, and suspicious rows before funds move." },
  { number: "03", icon: WalletCards, title: "Approve funding once", copy: "Review the final decision set and fund only the accepted total through one wallet signing flow." },
  { number: "04", icon: Zap, title: "Settle autonomously", copy: "A restricted NEAR key processes recipients while callbacks reconcile every outcome." },
];

const protections = [
  "Cannot override a deterministic rejection",
  "Cannot edit an approved recipient or amount",
  "Cannot access the owner’s full wallet key",
  "Cannot execute a retry without fresh approval",
];

export default function Home() {
  return (
    <main className={styles.landing}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Veyra home">
          <span>V</span><strong>Veyra</strong>
        </Link>
        <nav className={styles.nav} aria-label="Landing page navigation">
          <a href="#how">How it works</a>
          <a href="#agents">AI agents</a>
          <a href="#near">Why NEAR</a>
        </nav>
        <Link className={styles.headerCta} href="/dashboard">Open dashboard <ArrowRight size={15} /></Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <div className={styles.kicker}><Sparkles size={14} /> Built at NEAR Hackathon</div>
          <h1>From spreadsheet<br />to settled. <em>One flow.</em></h1>
          <p>Veyra gives finance teams an AI-powered operating layer for reviewing, funding, settling, and reconciling bulk payments on NEAR.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href="/dashboard">Launch the demo <ArrowRight size={17} /></Link>
            <a className={styles.secondaryCta} href="#how">See how it works <ChevronRight size={16} /></a>
          </div>
          <div className={styles.heroProof}>
            <span><ShieldCheck size={16} /> Policy protected</span>
            <span><LockKeyhole size={16} /> Restricted agent key</span>
            <span><Network size={16} /> Verifiable on NEAR</span>
          </div>
        </div>

        <div className={styles.productStage} aria-label="Illustration of a Veyra payment run">
          <div className={styles.orbitOne} aria-hidden="true" />
          <div className={styles.orbitTwo} aria-hidden="true" />
          <div className={styles.productCard}>
            <div className={styles.windowBar}><span /><span /><span /><small>payment-run.csv</small><b>NEAR testnet</b></div>
            <div className={styles.runHeader}>
              <div><small>PAYMENT RUN</small><strong>November operations</strong><span>300 uploaded recipients</span></div>
              <i><FileSearch size={19} /></i>
            </div>
            <div className={styles.agentBanner}>
              <span><BrainCircuit size={18} /></span>
              <div><strong>Treasury Readiness Agent</strong><small>Investigation complete · deterministic controls verified</small></div>
              <b>Ready</b>
            </div>
            <div className={styles.miniStats}>
              <div><small>Accepted</small><strong>298</strong></div>
              <div><small>Held</small><strong>2</strong></div>
              <div><small>Approved total</small><strong>12.84 NEAR</strong></div>
            </div>
            <div className={styles.paymentRows}>
              <div><span className={styles.success}><Check size={12} /></span><p><strong>alice.testnet</strong><small>Validated recipient</small></p><b>1.25 NEAR</b><em>Ready</em></div>
              <div><span className={styles.success}><Check size={12} /></span><p><strong>builder.testnet</strong><small>Account and limit verified</small></p><b>0.80 NEAR</b><em>Ready</em></div>
              <div><span className={styles.held}>!</span><p><strong>invalid wallet</strong><small>Invalid NEAR account format</small></p><b>2.00 NEAR</b><em className={styles.heldText}>Held</em></div>
            </div>
            <div className={styles.runFooter}><span><i style={{ width: "78%" }} /></span><small>298 payments prepared for autonomous settlement</small></div>
          </div>
          <div className={styles.floatingReceipt}><CircleCheck size={18} /><div><strong>Settlement verified</strong><small>Receipt reconciled on-chain</small></div></div>
        </div>
      </section>

      <section className={styles.signalBar} aria-label="Product capabilities">
        <div><strong>1,000</strong><span>rows per payment run</span></div>
        <div><strong>1</strong><span>wallet funding flow</span></div>
        <div><strong>2</strong><span>constrained AI agents</span></div>
        <div><strong>100%</strong><span>traceable decisions</span></div>
      </section>

      <section className={styles.problemSection}>
        <div className={styles.sectionLead}>
          <p className={styles.eyebrow}>The problem</p>
          <h2>Bulk payments should not feel like manual data entry with a wallet attached.</h2>
        </div>
        <div className={styles.problemGrid}>
          <article><span>01</span><h3>Approval fatigue</h3><p>Recipient-level prompts turn a large payment run into a slow, error-prone signing marathon.</p></article>
          <article><span>02</span><h3>Risk before funding</h3><p>Malformed accounts, duplicates, unsupported assets, and policy violations are easy to miss in a spreadsheet.</p></article>
          <article><span>03</span><h3>Weak recovery trails</h3><p>When a transfer fails, teams need evidence, a clear explanation, and a safe next action—not guesswork.</p></article>
        </div>
      </section>

      <section className={styles.workflowSection} id="how">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>One controlled workflow</p><h2>Human approval where it matters.<br /><em>Autonomy where it helps.</em></h2></div>
          <p>The owner controls funding. Veyra’s constrained agents handle the repetitive operational work around that decision.</p>
        </div>
        <div className={styles.workflowGrid}>
          {workflow.map(({ number, icon: Icon, title, copy }) => <article key={number}><div><span>{number}</span><Icon size={20} /></div><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className={styles.agentSection} id="agents">
        <div className={styles.agentIntro}>
          <p className={styles.eyebrow}>AI with boundaries</p>
          <h2>Agents that can explain<br />their work.</h2>
          <p>Veyra uses tool-calling agents for investigation and recovery, then records an observe → reason → act → verify trace for every run.</p>
          <ul>{protections.map((item) => <li key={item}><Check size={14} />{item}</li>)}</ul>
        </div>
        <div className={styles.agentCards}>
          <article className={styles.readinessCard}>
            <div className={styles.agentCardTop}><span><BrainCircuit size={21} /></span><small>BEFORE FUNDING</small></div>
            <h3>Treasury Readiness Agent</h3>
            <p>Chooses investigation tools, checks the payment file, and classifies every row as ready, review, or held.</p>
            <div className={styles.trace}><span>Observe</span><i /><span>Reason</span><i /><span>Act</span><i /><span>Verify</span></div>
          </article>
          <article className={styles.recoveryCard}>
            <div className={styles.agentCardTop}><span><RefreshCw size={21} /></span><small>AFTER SETTLEMENT</small></div>
            <h3>Failure Recovery Agent</h3>
            <p>Checks payment records, receipt evidence, and escrow state before explaining a failure or preparing an approval-gated retry.</p>
            <div className={styles.evidenceStack}><span><Database size={14} /> Payment record <b>Checked</b></span><span><Network size={14} /> Transaction receipt <b>Verified</b></span><span><LockKeyhole size={14} /> Recovery action <b>Approval required</b></span></div>
          </article>
        </div>
      </section>

      <section className={styles.nearSection} id="near">
        <div className={styles.nearPanel}>
          <div className={styles.nearCopy}>
            <p className={styles.eyebrow}>Why NEAR</p>
            <h2>Autonomous execution without surrendering control.</h2>
            <p>NEAR’s account model lets Veyra separate the owner’s authority from the agent’s narrow operational permissions.</p>
            <div className={styles.nearFeatures}>
              <span><LockKeyhole size={18} /><b>Function-call keys</b><small>Limit the agent to two settlement methods and a bounded gas allowance.</small></span>
              <span><ShieldCheck size={18} /><b>Exact escrow</b><small>Only the reviewed payment total enters the contract.</small></span>
              <span><Network size={18} /><b>Receipt evidence</b><small>Every final transfer can be verified in the transaction tree.</small></span>
            </div>
          </div>
          <div className={styles.flowVisual} aria-label="Veyra payment contract flow">
            <div className={styles.flowNode}><WalletCards size={19} /><span><small>OWNER</small><strong>One funding approval</strong></span></div>
            <i><ArrowRight size={17} /></i>
            <div className={`${styles.flowNode} ${styles.contractNode}`}><span className={styles.vMark}>V</span><span><small>VEYRA CONTRACT</small><strong>Exact payment escrow</strong></span></div>
            <i><ArrowRight size={17} /></i>
            <div className={styles.recipientNode}><span>A</span><span>B</span><span>C</span><b>+297</b><small>Verified recipients</small></div>
            <div className={styles.agentKey}><LockKeyhole size={14} /> Restricted agent key can only process approved items</div>
          </div>
        </div>
      </section>

      <section className={styles.auditSection}>
        <div className={styles.auditVisual}>
          <div className={styles.auditWindow}>
            <div className={styles.auditTitle}><span><History size={18} /></span><div><small>BATCH HISTORY</small><strong>November operations</strong></div><b>Complete</b></div>
            {["alice.testnet", "builder.testnet", "community.testnet"].map((account, index) => <div className={styles.auditRow} key={account}><CircleCheck size={15} /><span><strong>{account}</strong><small>Contract batch #{index < 2 ? 14 : 15}</small></span><b>{["1.25", "0.80", "2.10"][index]} NEAR</b><em>Success</em></div>)}
            <div className={styles.auditFoot}><span>300 payment records</span><b>Export CSV <ArrowRight size={13} /></b></div>
          </div>
        </div>
        <div className={styles.auditCopy}>
          <p className={styles.eyebrow}>Built for reconciliation</p>
          <h2>The complete story of every payment run.</h2>
          <p>Batch History brings the uploaded file, AI decisions, contract batches, recipient outcomes, and funding transactions into one scrollable audit record.</p>
          <div><span><History size={17} /> Full recipient ledger</span><span><Network size={17} /> NearBlocks transaction links</span><span><FileSpreadsheet size={17} /> Downloadable CSV reports</span></div>
        </div>
      </section>

      <section className={styles.treasuryStrip}>
        <div><span><Landmark size={22} /></span><p><small>BEYOND PAYMENTS</small><strong>Treasury Autopilot protects upcoming obligations and identifies only the policy-approved surplus available for NEAR yield strategies.</strong></p></div>
        <Link href="/dashboard">Explore treasury controls <ArrowRight size={16} /></Link>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.finalMark}>V</div>
        <p className={styles.eyebrow}>Built at NEAR Hackathon</p>
        <h2>Make the next payment run<br />an intelligent one.</h2>
        <p>Review risk, approve once, settle autonomously, and keep the evidence.</p>
        <Link className={styles.primaryCta} href="/dashboard">Open the Veyra dashboard <ArrowRight size={17} /></Link>
      </section>

      <footer className={styles.footer}>
        <Link className={styles.brand} href="/"><span>V</span><strong>Veyra</strong></Link>
        <p>AI-powered treasury operations on NEAR.</p>
        <div><a href="https://testnet.nearblocks.io/address/veyra-payments.testnet" target="_blank" rel="noreferrer">Testnet contract</a><a href="https://near.org" target="_blank" rel="noreferrer">Built on NEAR</a></div>
      </footer>
    </main>
  );
}
