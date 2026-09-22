import { z } from 'zod';
/**
 * The account half of `/v1`: who somebody is, how they are signed in, and how
 * they are reached.
 *
 * Two fields carry the whole privacy rule of this domain. `email` is the login
 * identity: it is what a person signs in with, and it is never serialised to
 * anyone but its owner and an administrator. `handle` is the only name others
 * ever see - on a public grow, on a profile page, beside an entry somebody else
 * wrote - and no real name is stored anywhere.
 */
/** Stripped from shared views, so that a visitor sees a grow without its numbers. */
export declare const userPrivacy: z.ZodObject<{
    hideWeights: z.ZodBoolean;
    hideCounts: z.ZodBoolean;
}, z.core.$strip>;
/**
 * Display and scheduling. `units` is presentation only; `timezone` is an IANA
 * name and is also what quiet hours are read in, so it is a fact the server
 * needs rather than a client-side preference.
 */
export declare const userPreferences: z.ZodObject<{
    units: z.ZodObject<{
        temperature: z.ZodEnum<{
            celsius: "celsius";
            fahrenheit: "fahrenheit";
        }>;
        weight: z.ZodEnum<{
            grams: "grams";
            ounces: "ounces";
        }>;
        volume: z.ZodEnum<{
            liters: "liters";
            gallons: "gallons";
        }>;
    }, z.core.$strip>;
    locale: z.ZodString;
    timezone: z.ZodString;
}, z.core.$strip>;
/** How long raw climate points are kept; `null` keeps them for as long as the install does. */
export declare const userRetention: z.ZodObject<{
    climateDays: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
/**
 * What the server sends. Transactional mail - activation, password reset - is
 * not routed and not listed.
 *
 * An alarm is two rows of the grid rather than one, because the two are wanted
 * on different channels: a tent that is too hot is `alerts` and goes wherever
 * somebody wants to be woken, a warning is `warnings` and is read in the
 * morning. Which row an alarm falls in is its rule's severity, and an alarm
 * whose severity is `info` is in neither - it stays in the inbox and is never
 * announced.
 */
export declare const notificationCategory: z.ZodEnum<{
    plan: "plan";
    alerts: "alerts";
    warnings: "warnings";
    tasks: "tasks";
    weekly_timelapse: "weekly_timelapse";
}>;
/**
 * A webhook the person owns. Its target and its headers are secrets - they can
 * name an internal host and carry an authorisation header - so they are on the
 * wire for their owner alone, on the account screens that set them, and appear
 * in no shared or public view. Per-alarm bodies and templates are a different
 * thing and live on the alarm rule's `delivery.custom`.
 */
export declare const webhookChannel: z.ZodObject<{
    url: z.ZodString;
    method: z.ZodEnum<{
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
    }>;
    headers: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strip>;
/** The chat the install's bot answers in, and which a reply is matched back to. */
export declare const telegramChannel: z.ZodObject<{
    chatId: z.ZodString;
    linkedAt: z.ZodISODateTime;
}, z.core.$strip>;
/**
 * The addresses. `null` is "not configured", which is also "off": the login
 * address is deliberately not used as a fallback, so that no notification goes
 * anywhere the person did not name.
 */
export declare const notificationChannels: z.ZodObject<{
    email: z.ZodNullable<z.ZodString>;
    telegram: z.ZodNullable<z.ZodObject<{
        chatId: z.ZodString;
        linkedAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    webhook: z.ZodNullable<z.ZodObject<{
        url: z.ZodString;
        method: z.ZodEnum<{
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
        }>;
        headers: z.ZodRecord<z.ZodString, z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * The what-goes-where grid: every category names the channels it goes out on,
 * and `[]` is "this category is not announced at all".
 */
export declare const notificationRouting: z.ZodRecord<z.ZodEnum<{
    plan: "plan";
    alerts: "alerts";
    warnings: "warnings";
    tasks: "tasks";
    weekly_timelapse: "weekly_timelapse";
}>, z.ZodArray<z.ZodEnum<{
    push: "push";
    email: "email";
    telegram: "telegram";
    webhook: "webhook";
}>>>;
/**
 * A wall-clock window in the person's own time zone, so it is minutes from
 * midnight rather than an instant - it has no date and no offset, and therefore
 * neither an ISO string nor an `...At` name. A window that crosses midnight has
 * `fromMinute` greater than `toMinute`. Critical alarms come through it.
 */
export declare const quietHours: z.ZodObject<{
    fromMinute: z.ZodNumber;
    toMinute: z.ZodNumber;
}, z.core.$strip>;
/** One send decision is made from this: mute, then quiet hours, then the routing. */
export declare const notificationSettings: z.ZodObject<{
    channels: z.ZodObject<{
        email: z.ZodNullable<z.ZodString>;
        telegram: z.ZodNullable<z.ZodObject<{
            chatId: z.ZodString;
            linkedAt: z.ZodISODateTime;
        }, z.core.$strip>>;
        webhook: z.ZodNullable<z.ZodObject<{
            url: z.ZodString;
            method: z.ZodEnum<{
                GET: "GET";
                POST: "POST";
                PUT: "PUT";
            }>;
            headers: z.ZodRecord<z.ZodString, z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    routing: z.ZodRecord<z.ZodEnum<{
        plan: "plan";
        alerts: "alerts";
        warnings: "warnings";
        tasks: "tasks";
        weekly_timelapse: "weekly_timelapse";
    }>, z.ZodArray<z.ZodEnum<{
        push: "push";
        email: "email";
        telegram: "telegram";
        webhook: "webhook";
    }>>>;
    quietHours: z.ZodNullable<z.ZodObject<{
        fromMinute: z.ZodNumber;
        toMinute: z.ZodNumber;
    }, z.core.$strip>>;
    mutedUntil: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/**
 * The account, as `GET /admin/users` answers it. Its owner is answered `Me`
 * below, and a sign-up `SignupUser`.
 *
 * There is no password hash here and there is no field for one: this contract
 * describes what crosses the wire, a secret never does, and where the hash is
 * kept is the mongoose schema's business. `activationCode` is the one secret of
 * this shape that does cross, and only towards an administrator.
 */
export declare const user: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    email: z.ZodString;
    isAdmin: z.ZodBoolean;
    isActive: z.ZodBoolean;
    activationCode: z.ZodNullable<z.ZodString>;
    handle: z.ZodString;
    bio: z.ZodNullable<z.ZodString>;
    avatarMediaId: z.ZodNullable<z.ZodString>;
    publicProfile: z.ZodBoolean;
    privacy: z.ZodObject<{
        hideWeights: z.ZodBoolean;
        hideCounts: z.ZodBoolean;
    }, z.core.$strip>;
    preferences: z.ZodObject<{
        units: z.ZodObject<{
            temperature: z.ZodEnum<{
                celsius: "celsius";
                fahrenheit: "fahrenheit";
            }>;
            weight: z.ZodEnum<{
                grams: "grams";
                ounces: "ounces";
            }>;
            volume: z.ZodEnum<{
                liters: "liters";
                gallons: "gallons";
            }>;
        }, z.core.$strip>;
        locale: z.ZodString;
        timezone: z.ZodString;
    }, z.core.$strip>;
    retention: z.ZodObject<{
        climateDays: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    notifications: z.ZodObject<{
        channels: z.ZodObject<{
            email: z.ZodNullable<z.ZodString>;
            telegram: z.ZodNullable<z.ZodObject<{
                chatId: z.ZodString;
                linkedAt: z.ZodISODateTime;
            }, z.core.$strip>>;
            webhook: z.ZodNullable<z.ZodObject<{
                url: z.ZodString;
                method: z.ZodEnum<{
                    GET: "GET";
                    POST: "POST";
                    PUT: "PUT";
                }>;
                headers: z.ZodRecord<z.ZodString, z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        routing: z.ZodRecord<z.ZodEnum<{
            plan: "plan";
            alerts: "alerts";
            warnings: "warnings";
            tasks: "tasks";
            weekly_timelapse: "weekly_timelapse";
        }>, z.ZodArray<z.ZodEnum<{
            push: "push";
            email: "email";
            telegram: "telegram";
            webhook: "webhook";
        }>>>;
        quietHours: z.ZodNullable<z.ZodObject<{
            fromMinute: z.ZodNumber;
            toMinute: z.ZodNumber;
        }, z.core.$strip>>;
        mutedUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
    deletionStartedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strip>;
/**
 * What this install says about Premium, read from its configuration. `enforced`
 * is false in a self-hosted install, where nothing is gated; `extendUrl` and
 * `priceLabel` are what the renewal notice links to and says, which is why this
 * server needs no billing of its own.
 */
export declare const premium: z.ZodObject<{
    enforced: z.ZodBoolean;
    extendUrl: z.ZodNullable<z.ZodString>;
    priceLabel: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `GET /me`: the account as its owner sees it, plus the three facts about the
 * install that the account screens need before they can offer anything - what
 * Premium costs here, the VAPID key a push subscription is made with, and
 * whether a Telegram bot is configured at all.
 */
export declare const me: z.ZodObject<{
    id: z.ZodString;
    notifications: z.ZodObject<{
        channels: z.ZodObject<{
            email: z.ZodNullable<z.ZodString>;
            telegram: z.ZodNullable<z.ZodObject<{
                chatId: z.ZodString;
                linkedAt: z.ZodISODateTime;
            }, z.core.$strip>>;
            webhook: z.ZodNullable<z.ZodObject<{
                url: z.ZodString;
                method: z.ZodEnum<{
                    GET: "GET";
                    POST: "POST";
                    PUT: "PUT";
                }>;
                headers: z.ZodRecord<z.ZodString, z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        routing: z.ZodRecord<z.ZodEnum<{
            plan: "plan";
            alerts: "alerts";
            warnings: "warnings";
            tasks: "tasks";
            weekly_timelapse: "weekly_timelapse";
        }>, z.ZodArray<z.ZodEnum<{
            push: "push";
            email: "email";
            telegram: "telegram";
            webhook: "webhook";
        }>>>;
        quietHours: z.ZodNullable<z.ZodObject<{
            fromMinute: z.ZodNumber;
            toMinute: z.ZodNumber;
        }, z.core.$strip>>;
        mutedUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>;
    email: z.ZodString;
    privacy: z.ZodObject<{
        hideWeights: z.ZodBoolean;
        hideCounts: z.ZodBoolean;
    }, z.core.$strip>;
    preferences: z.ZodObject<{
        units: z.ZodObject<{
            temperature: z.ZodEnum<{
                celsius: "celsius";
                fahrenheit: "fahrenheit";
            }>;
            weight: z.ZodEnum<{
                grams: "grams";
                ounces: "ounces";
            }>;
            volume: z.ZodEnum<{
                liters: "liters";
                gallons: "gallons";
            }>;
        }, z.core.$strip>;
        locale: z.ZodString;
        timezone: z.ZodString;
    }, z.core.$strip>;
    retention: z.ZodObject<{
        climateDays: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    createdAt: z.ZodISODateTime;
    isAdmin: z.ZodBoolean;
    isActive: z.ZodBoolean;
    handle: z.ZodString;
    bio: z.ZodNullable<z.ZodString>;
    avatarMediaId: z.ZodNullable<z.ZodString>;
    publicProfile: z.ZodBoolean;
    deletionStartedAt: z.ZodNullable<z.ZodISODateTime>;
    premium: z.ZodObject<{
        enforced: z.ZodBoolean;
        extendUrl: z.ZodNullable<z.ZodString>;
        priceLabel: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    pushPublicKey: z.ZodNullable<z.ZodString>;
    telegramAvailable: z.ZodBoolean;
    pushSubscribed: z.ZodBoolean;
}, z.core.$strip>;
/**
 * `PATCH /me`. Only what the person owns: the login address is the identity and
 * is not changed here, and `isAdmin`, `isActive` and the activation code are an
 * administrator's.
 */
export declare const meUpdate: z.ZodObject<{
    notifications: z.ZodOptional<z.ZodObject<{
        channels: z.ZodObject<{
            email: z.ZodNullable<z.ZodString>;
            telegram: z.ZodNullable<z.ZodObject<{
                chatId: z.ZodString;
                linkedAt: z.ZodISODateTime;
            }, z.core.$strip>>;
            webhook: z.ZodNullable<z.ZodObject<{
                url: z.ZodString;
                method: z.ZodEnum<{
                    GET: "GET";
                    POST: "POST";
                    PUT: "PUT";
                }>;
                headers: z.ZodRecord<z.ZodString, z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        routing: z.ZodRecord<z.ZodEnum<{
            plan: "plan";
            alerts: "alerts";
            warnings: "warnings";
            tasks: "tasks";
            weekly_timelapse: "weekly_timelapse";
        }>, z.ZodArray<z.ZodEnum<{
            push: "push";
            email: "email";
            telegram: "telegram";
            webhook: "webhook";
        }>>>;
        quietHours: z.ZodNullable<z.ZodObject<{
            fromMinute: z.ZodNumber;
            toMinute: z.ZodNumber;
        }, z.core.$strip>>;
        mutedUntil: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    privacy: z.ZodOptional<z.ZodObject<{
        hideWeights: z.ZodBoolean;
        hideCounts: z.ZodBoolean;
    }, z.core.$strip>>;
    preferences: z.ZodOptional<z.ZodObject<{
        units: z.ZodObject<{
            temperature: z.ZodEnum<{
                celsius: "celsius";
                fahrenheit: "fahrenheit";
            }>;
            weight: z.ZodEnum<{
                grams: "grams";
                ounces: "ounces";
            }>;
            volume: z.ZodEnum<{
                liters: "liters";
                gallons: "gallons";
            }>;
        }, z.core.$strip>;
        locale: z.ZodString;
        timezone: z.ZodString;
    }, z.core.$strip>>;
    retention: z.ZodOptional<z.ZodObject<{
        climateDays: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    handle: z.ZodOptional<z.ZodString>;
    bio: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    avatarMediaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    publicProfile: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/** `PUT /me/password`. The current one is asked for again, because a stolen session must not be able to keep itself. */
export declare const passwordChange: z.ZodObject<{
    currentPassword: z.ZodString;
    newPassword: z.ZodString;
}, z.core.$strip>;
/**
 * `POST /users`. A sign-up names its own handle, because it is the only name
 * this account will ever show and inventing one would only have to be corrected.
 */
export declare const userCreate: z.ZodObject<{
    email: z.ZodString;
    handle: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
/**
 * What a sign-up is told about the account it just made. Never the activation
 * code: the route is open, so anyone could otherwise activate an address they do
 * not own.
 */
export declare const signupUser: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    createdAt: z.ZodISODateTime;
    isActive: z.ZodBoolean;
    handle: z.ZodString;
}, z.core.$strip>;
/**
 * `POST /users/activations`. The code is the whole proof, so nothing else is
 * asked for, and the route answers 204: the client signs in afterwards like
 * anyone else, rather than being handed a session by a code that arrived in a
 * mail somebody else may be reading.
 *
 * It is the account's own field, without the `null` that only the resource needs
 * - there an account that was never sent a code has none, here the code is the
 * entire request.
 */
export declare const userActivation: z.ZodObject<{
    activationCode: z.ZodString;
}, z.core.$strip>;
/**
 * One signed token and the instant it stops working. A duration would be the
 * other way of saying it; the instant is what a client can compare against its
 * own clock without having to remember when it asked.
 */
export declare const authToken: z.ZodObject<{
    token: z.ZodString;
    validUntil: z.ZodISODateTime;
}, z.core.$strip>;
/**
 * The three tokens a session is made of: one to call with, one to renew it, one
 * for picture URLs. Handed once to the client that signed in and never answered
 * again - `GET /sessions` names a session by its id, which is not a secret.
 */
export declare const sessionTokens: z.ZodObject<{
    userToken: z.ZodObject<{
        token: z.ZodString;
        validUntil: z.ZodISODateTime;
    }, z.core.$strip>;
    refreshToken: z.ZodObject<{
        token: z.ZodString;
        validUntil: z.ZodISODateTime;
    }, z.core.$strip>;
    mediaToken: z.ZodObject<{
        token: z.ZodString;
        validUntil: z.ZodISODateTime;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * A session, as `GET /sessions` lists it and `DELETE /sessions/{id}` revokes
 * it. Everything here is the server's own bookkeeping - there is nothing a
 * client writes - so unlike the resources that carry settings, a session has no
 * configuration to keep apart from its state.
 */
export declare const session: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    userId: z.ZodString;
    userAgent: z.ZodNullable<z.ZodString>;
    lastSeenAt: z.ZodISODateTime;
    expiresAt: z.ZodISODateTime;
}, z.core.$strip>;
export declare const sessionPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        userId: z.ZodString;
        userAgent: z.ZodNullable<z.ZodString>;
        lastSeenAt: z.ZodISODateTime;
        expiresAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** `POST /sessions`. The login identity is the e-mail address; there is no user name to remember. */
export declare const sessionCreate: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    stayLoggedIn: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Who the session belongs to, as the sign-in routes report it. Enough to draw
 * the shell - the rest of the account is `GET /me` - and `isDemo` says there is
 * no account behind it at all.
 */
export declare const sessionUser: z.ZodObject<{
    id: z.ZodString;
    handle: z.ZodString;
    isAdmin: z.ZodBoolean;
    isDemo: z.ZodBoolean;
}, z.core.$strip>;
/** What `POST /sessions` and `POST /sessions/demo` answer. The id is how this session revokes itself. */
export declare const sessionResult: z.ZodObject<{
    userToken: z.ZodObject<{
        token: z.ZodString;
        validUntil: z.ZodISODateTime;
    }, z.core.$strip>;
    refreshToken: z.ZodObject<{
        token: z.ZodString;
        validUntil: z.ZodISODateTime;
    }, z.core.$strip>;
    mediaToken: z.ZodObject<{
        token: z.ZodString;
        validUntil: z.ZodISODateTime;
    }, z.core.$strip>;
    sessionId: z.ZodString;
    user: z.ZodObject<{
        id: z.ZodString;
        handle: z.ZodString;
        isAdmin: z.ZodBoolean;
        isDemo: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * `POST /sessions/demo`: the tour of the demo objects, which needs no
 * credentials and therefore carries nothing. The empty body is named all the
 * same, so that the contract says "this route takes no arguments" rather than
 * leaving a client to guess what it forgot to send.
 */
export declare const demoSessionCreate: z.ZodObject<{}, z.core.$strip>;
/**
 * `POST /sessions/refresh`. The refresh token is spent and a fresh
 * `SessionTokens` triple comes back - not a `SessionResult`: the session and the
 * person behind it are the ones the client already knows.
 */
export declare const sessionRefresh: z.ZodObject<{
    refreshToken: z.ZodString;
}, z.core.$strip>;
/** `POST /sessions/automation`. The token is the install's own, out of its configuration. */
export declare const automationSessionCreate: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
/**
 * What the automation token buys: a short-lived administrator session and
 * nothing to renew it with, so a caller that needs longer asks again.
 */
export declare const automationSession: z.ZodObject<{
    userToken: z.ZodObject<{
        token: z.ZodString;
        validUntil: z.ZodISODateTime;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * `POST /password-resets`. Answered 202 with no body, the same way whether or
 * not the address has an account: what comes back must not tell a stranger who
 * is registered here.
 */
export declare const passwordResetCreate: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
/**
 * `POST /password-resets/{token}/redemptions`. The token is in the path, because
 * it is what was mailed. Answers 204 and no session, so that a reset link read
 * by somebody else is one more thing to sign in with rather than a way in.
 */
export declare const passwordResetRedemption: z.ZodObject<{
    password: z.ZodString;
}, z.core.$strip>;
/** The Web Push keys the browser hands out with its endpoint. */
export declare const pushSubscriptionKeys: z.ZodObject<{
    p256dh: z.ZodString;
    auth: z.ZodString;
}, z.core.$strip>;
export declare const pushSubscription: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    userId: z.ZodString;
    endpoint: z.ZodString;
    keys: z.ZodObject<{
        p256dh: z.ZodString;
        auth: z.ZodString;
    }, z.core.$strip>;
    userAgent: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** `POST /me/push-subscriptions`. The endpoint identifies it, so re-subscribing the same browser is an upsert. */
export declare const pushSubscriptionCreate: z.ZodObject<{
    keys: z.ZodObject<{
        p256dh: z.ZodString;
        auth: z.ZodString;
    }, z.core.$strip>;
    endpoint: z.ZodString;
}, z.core.$strip>;
/**
 * `POST /me/telegram-link`: the one-time link that connects a chat to this
 * account. The request carries nothing - the session says whose account it is -
 * and this is the answer. Opening the link starts the install's bot, which is
 * what produces the `chatId` in `NotificationChannels`.
 *
 * The URL carries the link secret, so it is answered to the person who asked for
 * it and to nobody else; whoever opens it gets the chat bound to this account.
 */
export declare const telegramLink: z.ZodObject<{
    url: z.ZodString;
    validUntil: z.ZodISODateTime;
}, z.core.$strip>;
/**
 * What was sent to whom. It is what keeps a due task from being announced
 * twice, and what maps a Telegram reply back to the thing it answers - hence
 * `externalMessageId`, which is the id the channel gave the message and is null
 * for a channel that gives none.
 */
export declare const notificationSubjectType: z.ZodEnum<{
    media: "media";
    alert: "alert";
    plan: "plan";
    task: "task";
}>;
export declare const notificationLogEntry: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    userId: z.ZodString;
    channel: z.ZodEnum<{
        push: "push";
        email: "email";
        telegram: "telegram";
        webhook: "webhook";
    }>;
    category: z.ZodEnum<{
        plan: "plan";
        alerts: "alerts";
        warnings: "warnings";
        tasks: "tasks";
        weekly_timelapse: "weekly_timelapse";
    }>;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            media: "media";
            alert: "alert";
            plan: "plan";
            task: "task";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    externalMessageId: z.ZodNullable<z.ZodString>;
    sentAt: z.ZodISODateTime;
    expiresAt: z.ZodISODateTime;
}, z.core.$strip>;
export declare const exportStatus: z.ZodEnum<{
    failed: "failed";
    running: "running";
    ready: "ready";
    queued: "queued";
}>;
/**
 * `GET /me/export`. Zipping a person's grows, their CSVs and their photos does
 * not finish inside a request, so the route answers this and it is polled until
 * `downloadUrl` is there.
 */
export declare const userExport: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodISODateTime;
    status: z.ZodEnum<{
        failed: "failed";
        running: "running";
        ready: "ready";
        queued: "queued";
    }>;
    startedAt: z.ZodNullable<z.ZodISODateTime>;
    endedAt: z.ZodNullable<z.ZodISODateTime>;
    downloadUrl: z.ZodNullable<z.ZodString>;
    validUntil: z.ZodNullable<z.ZodISODateTime>;
    detail: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `GET /admin/users`. An administrator is the one other reader of an address and
 * the only reader of an activation code, which is all of `User` as it stands -
 * so there is no narrower admin shape to name, and the list is a page of users.
 */
export declare const adminUserPage: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        createdAt: z.ZodISODateTime;
        email: z.ZodString;
        isAdmin: z.ZodBoolean;
        isActive: z.ZodBoolean;
        activationCode: z.ZodNullable<z.ZodString>;
        handle: z.ZodString;
        bio: z.ZodNullable<z.ZodString>;
        avatarMediaId: z.ZodNullable<z.ZodString>;
        publicProfile: z.ZodBoolean;
        privacy: z.ZodObject<{
            hideWeights: z.ZodBoolean;
            hideCounts: z.ZodBoolean;
        }, z.core.$strip>;
        preferences: z.ZodObject<{
            units: z.ZodObject<{
                temperature: z.ZodEnum<{
                    celsius: "celsius";
                    fahrenheit: "fahrenheit";
                }>;
                weight: z.ZodEnum<{
                    grams: "grams";
                    ounces: "ounces";
                }>;
                volume: z.ZodEnum<{
                    liters: "liters";
                    gallons: "gallons";
                }>;
            }, z.core.$strip>;
            locale: z.ZodString;
            timezone: z.ZodString;
        }, z.core.$strip>;
        retention: z.ZodObject<{
            climateDays: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        notifications: z.ZodObject<{
            channels: z.ZodObject<{
                email: z.ZodNullable<z.ZodString>;
                telegram: z.ZodNullable<z.ZodObject<{
                    chatId: z.ZodString;
                    linkedAt: z.ZodISODateTime;
                }, z.core.$strip>>;
                webhook: z.ZodNullable<z.ZodObject<{
                    url: z.ZodString;
                    method: z.ZodEnum<{
                        GET: "GET";
                        POST: "POST";
                        PUT: "PUT";
                    }>;
                    headers: z.ZodRecord<z.ZodString, z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
            routing: z.ZodRecord<z.ZodEnum<{
                plan: "plan";
                alerts: "alerts";
                warnings: "warnings";
                tasks: "tasks";
                weekly_timelapse: "weekly_timelapse";
            }>, z.ZodArray<z.ZodEnum<{
                push: "push";
                email: "email";
                telegram: "telegram";
                webhook: "webhook";
            }>>>;
            quietHours: z.ZodNullable<z.ZodObject<{
                fromMinute: z.ZodNumber;
                toMinute: z.ZodNumber;
            }, z.core.$strip>>;
            mutedUntil: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strip>;
        deletionStartedAt: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `POST /admin/users`. A sign-up plus the two flags only an administrator may
 * set; both are optional, and an account made this way is active at once and has
 * no activation code, because whoever created it can hand the password over.
 */
export declare const adminUserCreate: z.ZodObject<{
    email: z.ZodString;
    handle: z.ZodString;
    password: z.ZodString;
    isAdmin: z.ZodOptional<z.ZodBoolean>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * `PATCH /admin/users/{id}`: the same fields, each only if it changes. `password`
 * among them, which is how an administrator resets one for somebody who cannot
 * receive the mail.
 */
export declare const adminUserUpdate: z.ZodObject<{
    email: z.ZodOptional<z.ZodString>;
    handle: z.ZodOptional<z.ZodString>;
    password: z.ZodOptional<z.ZodString>;
    isAdmin: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    isActive: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
/**
 * What a Web Push carries, as the server encodes it and the service worker
 * reads it: the two lines of the announcement and what it is about. It is
 * named here because the worker in the browser and the channel on the server
 * are two ends of one wire, and a field renamed on one end would otherwise be
 * found by a push that shows nothing.
 */
export declare const pushPayload: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    category: z.ZodEnum<{
        plan: "plan";
        alerts: "alerts";
        warnings: "warnings";
        tasks: "tasks";
        weekly_timelapse: "weekly_timelapse";
    }>;
    subject: z.ZodObject<{
        type: z.ZodEnum<{
            media: "media";
            alert: "alert";
            plan: "plan";
            task: "task";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    severity: z.ZodEnum<{
        critical: "critical";
        warning: "warning";
        info: "info";
    }>;
}, z.core.$strip>;
