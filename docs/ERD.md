erDiagram
    activity {
        bigint id PK
        text name
        text category
        text description
        timestamptz created_at
        timestamptz updated_at
        text[] tags
        bigint external_id
        text provider
    }
    centre {
        bigint id PK
        text name
        text description
        text street
        text city
        text state
        text country
        timestamptz created_at
        timestamptz updated_at
        text zip_code
        text phone
        bigint external_id
        text provider
    }
    event {
        bigint id PK
        bigint external_activity_id
        bigint external_centre_id
        timestamptz starts_at
        timestamptz ends_at
        text title
        text description
        text url
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
        text provider
        bigint activity_id FK
        bigint centre_id FK
        bigint external_id
    }

    activity ||--o{ event : "has events"
    centre   ||--o{ event : "hosts events"