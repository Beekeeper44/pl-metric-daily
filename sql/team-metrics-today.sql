/* Team Metrics — Today (LA date) — v1
   One row. Save as its own Metabase question; put its ID in PL_TODAY_QUESTION_ID.
   AC = Arena Club user 00838bfd-7979-41bd-81f5-c6777c32d6c4. Raw = NOT is_pre_graded.
*/
WITH params AS (
    SELECT (CONVERT_TIMEZONE('America/Los_Angeles', CURRENT_TIMESTAMP()))::date AS today
),

/* Customer raw: review op-log finished today (same rule as All Orders (PL)) */
review_today AS (
    SELECT DISTINCT card_id
    FROM   APP_PROD.ADMIN.OPERATION_LOGS
    WHERE  created_at >= DATEADD('day', -30, CURRENT_TIMESTAMP())
      AND  kind = 'review'
      AND  finished_at IS NOT NULL
      AND  (CONVERT_TIMEZONE('America/Los_Angeles', finished_at))::date = (SELECT today FROM params)
      AND  NOT COALESCE(_SNOWFLAKE_DELETED, FALSE)
),

/* AC raw: an estimated value was entered today */
ev_today AS (
    SELECT DISTINCT card_id
    FROM   APP_PROD.ADMIN.ESTIMATED_VALUE
    WHERE  created_at >= DATEADD('day', -3, CURRENT_TIMESTAMP())
      AND  (CONVERT_TIMEZONE('UTC', 'America/Los_Angeles', created_at))::date = (SELECT today FROM params)
      AND  NOT COALESCE(_SNOWFLAKE_DELETED, FALSE)
),

cards_base AS (
    SELECT
        c.id                                                         AS card_id,
        COALESCE(c.is_pre_graded, FALSE)                             AS is_pre_graded,
        (i.user_id = '00838bfd-7979-41bd-81f5-c6777c32d6c4')         AS is_ac,
        (CONVERT_TIMEZONE('UTC', 'America/Los_Angeles',
            COALESCE(c.ready_to_reveal_email_sent_at, o.ready_to_reveal_email_sent_at)))::date
            = (SELECT today FROM params)                             AS revealed_today,
        (rt.card_id IS NOT NULL)                                     AS reviewed_today,
        (et.card_id IS NOT NULL)                                     AS ev_today
    FROM      APP_PROD.ADMIN.CARDS  c
    LEFT JOIN APP_PROD.PUBLIC.ITEMS  i  ON i.id = c.id AND i.category = 'card'
    LEFT JOIN APP_PROD.PUBLIC.ORDERS o  ON o.id = c.order_id
    LEFT JOIN review_today rt           ON rt.card_id = c.id
    LEFT JOIN ev_today     et           ON et.card_id = c.id
    WHERE c.created_at >= DATEADD('day', -180, CURRENT_TIMESTAMP())
      AND NOT COALESCE(c._SNOWFLAKE_DELETED, FALSE)
      AND COALESCE(c.status, '') <> 'archived'
)

SELECT
    COUNT_IF(    is_ac AND NOT is_pre_graded AND revealed_today)          AS ac_raw_reveal_today,
    COUNT_IF(NOT is_ac AND NOT is_pre_graded AND revealed_today)          AS cust_raw_reveal_today,
    COUNT_IF(    is_ac AND     is_pre_graded AND revealed_today)          AS ac_pregraded_reveal_today,
    COUNT_IF(NOT is_ac AND     is_pre_graded AND revealed_today)          AS cust_pregraded_reveal_today,
    COUNT_IF(    is_ac AND NOT is_pre_graded AND ev_today)                AS ac_raw_ev_done_today,
    COUNT_IF(NOT is_ac AND NOT is_pre_graded AND reviewed_today)          AS cust_raw_reviewed_today
FROM cards_base;
