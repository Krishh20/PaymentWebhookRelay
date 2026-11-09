"use client";

import { useCallback, useState } from "react";
import OverviewSection from "../components/OverviewSection";
import EventsSection from "../components/EventsSection";
import DeliveriesSection from "../components/DeliveriesSection";
import DeadLetterSection from "../components/DeadLetterSection";
import DetailDrawer from "../components/DetailDrawer";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "events", label: "Events" },
  { id: "deliveries", label: "Delivery Monitoring" },
  { id: "dead-letter", label: "Failed Events / Dead Letter Queue" },
];

export default function DashboardPage() {
  const [section, setSection] = useState("overview");
  const [detail, setDetail] = useState(null);

  const openEvent = useCallback((id) => {
    setDetail({ type: "event", id });
  }, []);

  const openDelivery = useCallback((id) => {
    setDetail({ type: "delivery", id });
  }, []);

  const closeDetail = useCallback(() => {
    setDetail(null);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            PR
          </div>
          <div>
            <p className="brand-title">Payment Webhook Relay</p>
            <p className="brand-subtitle">Local delivery monitor</p>
          </div>
        </div>
        <div className="environment-chip">
          <span className="pulse-dot" aria-hidden="true" />
          Local environment
        </div>
      </header>

      <nav className="tabs" aria-label="Dashboard sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab ${section === item.id ? "active" : ""}`}
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {section === "overview" ? <OverviewSection /> : null}
        {section === "events" ? (
          <EventsSection onOpenEvent={openEvent} />
        ) : null}
        {section === "deliveries" ? (
          <DeliveriesSection onOpenDelivery={openDelivery} />
        ) : null}
        {section === "dead-letter" ? (
          <DeadLetterSection onOpenEvent={openEvent} />
        ) : null}
      </main>

      <DetailDrawer target={detail} onClose={closeDetail} />
    </div>
  );
}
