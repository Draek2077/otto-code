-- A self-contained schema, seed and analysis.
-- Run top to bottom on an empty database; nothing external is referenced.
--
-- Exercises DDL, constraints, CTEs, window functions, aggregates,
-- CASE expressions, views and comments.

CREATE TABLE lighthouse (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL UNIQUE,
    established   INTEGER NOT NULL CHECK (established BETWEEN 1500 AND 2100),
    height_m      REAL    NOT NULL CHECK (height_m > 0),
    active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE keeper (
    id            INTEGER PRIMARY KEY,
    lighthouse_id INTEGER NOT NULL REFERENCES lighthouse (id),
    name          TEXT    NOT NULL,
    started       INTEGER NOT NULL,
    ended         INTEGER
);

INSERT INTO lighthouse (id, name, established, height_m, active) VALUES
    (1, 'Eddystone',     1698, 49.0, TRUE),
    (2, 'Fastnet',       1904, 54.0, TRUE),
    (3, 'Rubjerg Knude', 1900, 23.0, FALSE),
    (4, 'Bell Rock',     1810, 35.3, TRUE),
    (5, 'La Jument',     1911, 47.0, TRUE);

INSERT INTO keeper (id, lighthouse_id, name, started, ended) VALUES
    (1, 1, 'Henry Winstanley', 1698, 1703),
    (2, 1, 'John Rudyard',     1709, 1755),
    (3, 2, 'James Kavanagh',   1904, 1927),
    (4, 4, 'Robert Stevenson', 1810, 1843),
    (5, 5, 'Théodore Malgorn', 1911, 1946),
    (6, 5, 'Michel Guégan',    1946, 1991);

-- How long each keeper served, ranked within their own lighthouse.
WITH tenure AS (
    SELECT
        k.name                                   AS keeper,
        l.name                                   AS lighthouse,
        k.started,
        COALESCE(k.ended, 2026)                  AS finished,
        COALESCE(k.ended, 2026) - k.started      AS years
    FROM keeper AS k
    JOIN lighthouse AS l ON l.id = k.lighthouse_id
)
SELECT
    lighthouse,
    keeper,
    years,
    RANK()      OVER (PARTITION BY lighthouse ORDER BY years DESC) AS rank_at_light,
    SUM(years)  OVER (PARTITION BY lighthouse)                     AS light_total,
    ROUND(AVG(years) OVER (), 1)                                   AS overall_mean,
    CASE
        WHEN years >= 40 THEN 'a lifetime'
        WHEN years >= 20 THEN 'a career'
        ELSE 'a posting'
    END AS verdict
FROM tenure
ORDER BY lighthouse, rank_at_light;

-- A view for the ones still burning.
CREATE VIEW active_lights AS
SELECT name, established, height_m,
       2026 - established AS age_years
FROM lighthouse
WHERE active
ORDER BY established;

SELECT COUNT(*) AS active_count, ROUND(AVG(height_m), 2) AS mean_height
FROM active_lights;
