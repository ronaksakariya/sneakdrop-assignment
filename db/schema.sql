CREATE TABLE units (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'HELD', 'SOLD'))
);

INSERT INTO units (status)
SELECT 'AVAILABLE'
FROM generate_series(1, 20);


CREATE TABLE holds (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    unit_id INTEGER NOT NULL REFERENCES units(id),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'PAID', 'EXPIRED', 'RELEASED')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE waitlist (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'WAITING'
        CHECK (status IN ('WAITING', 'PROMOTED', 'CANCELLED'))
);


CREATE TABLE payments (
    id BIGSERIAL PRIMARY KEY,
    hold_id BIGINT NOT NULL REFERENCES holds(id),
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'LATE_REFUNDED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    provider_payment_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE payment_events (
    id BIGSERIAL PRIMARY KEY,
    provider_event_id TEXT NOT NULL UNIQUE,
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX one_active_hold_per_user
ON holds (user_id)
WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX one_active_hold_per_unit
ON holds (unit_id)
WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX one_pending_payment_per_hold
ON payments (hold_id)
WHERE status = 'PENDING';

CREATE INDEX active_holds_expiry_idx
ON holds (expires_at)
WHERE status = 'ACTIVE';

CREATE INDEX waitlist_fifo_idx
ON waitlist (created_at, id)
WHERE status = 'WAITING';