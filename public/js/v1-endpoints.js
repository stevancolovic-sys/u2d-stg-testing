// GENERATED from the published OpenAPI document — do not edit by hand.
// Rebuild with: npm run build:v1
//
// UpToData API (/v1) 1.0.0
// Authenticated with an X-API-Key header, which the Worker adds; the key
// never reaches the browser.

export const V1_BASES = {
  staging: 'https://api.staging.uptodata.io/v1',
  production: 'https://api.uptodata.io/v1',
}

export const V1_ENDPOINTS = [
  {
    "takesNothing": false,
    "id": "profiles-enrich",
    "group": "Profiles",
    "label": "Enrich a profile",
    "method": "POST",
    "path": "/profiles/enrich",
    "summary": "Turn any LinkedIn profile URL into a full live record, scraped at request time.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://www.linkedin.com/in/satyanadella",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "urn",
        "label": "urn",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "fields",
        "label": "fields",
        "required": false,
        "primary": false,
        "type": "tags",
        "in": "body"
      },
      {
        "name": "with_followers_and_connections",
        "label": "with_followers_and_connections",
        "required": false,
        "primary": true,
        "type": "boolean",
        "default": true,
        "in": "body"
      },
      {
        "name": "with_full_skills_and_endorsements",
        "label": "with_full_skills_and_endorsements",
        "required": false,
        "primary": true,
        "type": "boolean",
        "default": true,
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "profiles-activity",
    "group": "Profiles",
    "label": "Get profile activity",
    "method": "POST",
    "path": "/profiles/activity",
    "summary": "Get one profile's authored posts, comments, reactions, or reposts, one kind per call.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://linkedin.com/in/janedoe",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "urn",
        "label": "urn",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "kind",
        "label": "kind",
        "required": true,
        "primary": true,
        "type": "text",
        "default": "posts",
        "in": "body"
      },
      {
        "name": "posted_within",
        "label": "posted_within",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "month",
        "in": "body"
      },
      {
        "name": "page",
        "label": "page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "per_page",
        "label": "per_page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "pagination_token",
        "label": "pagination_token",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "profiles-recommendations",
    "group": "Profiles",
    "label": "Get profile recommendations",
    "method": "POST",
    "path": "/profiles/recommendations",
    "summary": "Get the written recommendations a profile has received, given, or both.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://www.linkedin.com/in/janedoe",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "urn",
        "label": "urn",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "direction",
        "label": "direction",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "both",
        "in": "body"
      },
      {
        "name": "page",
        "label": "page",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 1,
        "in": "body"
      },
      {
        "name": "per_page",
        "label": "per_page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "profiles-interests",
    "group": "Profiles",
    "label": "Get profile interests",
    "method": "POST",
    "path": "/profiles/interests",
    "summary": "Get what a profile follows: top voices, companies, groups, newsletters, and schools.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://www.linkedin.com/in/janedoe",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "urn",
        "label": "urn",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "category",
        "label": "category",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "companies",
        "in": "body"
      },
      {
        "name": "page",
        "label": "page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "per_page",
        "label": "per_page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "companies-enrich",
    "group": "Companies",
    "label": "Enrich a company",
    "method": "POST",
    "path": "/companies/enrich",
    "summary": "Turn any LinkedIn company URL, domain, or ID into live firmographics.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://linkedin.com/company/anthropic",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "domain",
        "label": "domain",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "linkedin_id",
        "label": "linkedin_id",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "fields",
        "label": "fields",
        "required": false,
        "primary": false,
        "type": "tags",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "companies-jobs-count",
    "group": "Companies",
    "label": "Count company job openings",
    "method": "POST",
    "path": "/companies/jobs-count",
    "summary": "Return the number of active job postings a company has on LinkedIn.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://linkedin.com/company/anthropic",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "domain",
        "label": "domain",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "linkedin_id",
        "label": "linkedin_id",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "companies-posts",
    "group": "Companies",
    "label": "Get company posts",
    "method": "POST",
    "path": "/companies/posts",
    "summary": "List recent posts published by a company page.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://linkedin.com/company/anthropic",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "domain",
        "label": "domain",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "linkedin_id",
        "label": "linkedin_id",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "page",
        "label": "page",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 1,
        "in": "body"
      },
      {
        "name": "per_page",
        "label": "per_page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "pagination_token",
        "label": "pagination_token",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "companies-headcount",
    "group": "Companies",
    "label": "Find custom headcount",
    "method": "POST",
    "path": "/companies/headcount",
    "summary": "Count employees at a company matching title, seniority, location, or keyword filters.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": true,
        "primary": true,
        "type": "text",
        "default": "https://linkedin.com/company/anthropic",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "company_url",
        "label": "company_url",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      },
      {
        "name": "filters",
        "label": "filters",
        "required": true,
        "primary": true,
        "type": "json",
        "default": "{\n  \"titles\": [\n    \"Software Engineer\"\n  ],\n  \"locations\": [\n    \"United States\"\n  ]\n}",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "jobs-enrich",
    "group": "Jobs",
    "label": "Enrich a job",
    "method": "POST",
    "path": "/jobs/enrich",
    "summary": "Fetch full details for a single LinkedIn job posting, including the description and company.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://www.linkedin.com/jobs/view/4470130770",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "job_id",
        "label": "job_id",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "search-jobs",
    "group": "Jobs",
    "label": "Search jobs",
    "method": "POST",
    "path": "/search/jobs",
    "summary": "Live LinkedIn job postings by company, keyword, and filters.",
    "fields": [
      {
        "name": "company_url",
        "label": "company_url",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      },
      {
        "name": "keywords",
        "label": "keywords",
        "required": false,
        "primary": true,
        "type": "tags",
        "default": [
          "golang"
        ],
        "in": "body"
      },
      {
        "name": "filters",
        "label": "filters",
        "required": false,
        "primary": true,
        "type": "json",
        "default": "{\n  \"workplace_type\": [\n    \"remote\"\n  ],\n  \"posted_within_days\": 7\n}",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 25,
        "in": "body"
      },
      {
        "name": "per_page",
        "label": "per_page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "page",
        "label": "page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "pagination_token",
        "label": "pagination_token",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "posts-enrich",
    "group": "Posts",
    "label": "Enrich a post",
    "method": "POST",
    "path": "/posts/enrich",
    "summary": "Fetch one LinkedIn post by URL: full text plus live engagement.",
    "fields": [
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://linkedin.com/posts/ceo_launch-activity-7215",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "urn",
        "label": "urn",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "search-posts",
    "group": "Posts",
    "label": "Search posts",
    "method": "POST",
    "path": "/search/posts",
    "summary": "Live LinkedIn post search by keyword, hashtag, or author.",
    "fields": [
      {
        "name": "keywords",
        "label": "keywords",
        "required": false,
        "primary": true,
        "type": "tags",
        "default": [
          "ai agents"
        ],
        "in": "body"
      },
      {
        "name": "hashtags",
        "label": "hashtags",
        "required": false,
        "primary": false,
        "type": "tags",
        "in": "body"
      },
      {
        "name": "author_url",
        "label": "author_url",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      },
      {
        "name": "author_urn",
        "label": "author_urn",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      },
      {
        "name": "posted_within",
        "label": "posted_within",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "week",
        "in": "body"
      },
      {
        "name": "sort",
        "label": "sort",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "recent",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 25,
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "posts-engagement-comments",
    "group": "Posts",
    "label": "Get post comments",
    "method": "POST",
    "path": "/posts/engagement/comments",
    "summary": "Inbound engagement on a post - who commented, with profile stubs.",
    "fields": [
      {
        "name": "urn",
        "label": "urn",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "7267273010393358336",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "share_urn",
        "label": "share_urn",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "page",
        "label": "page",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 1,
        "in": "body"
      },
      {
        "name": "per_page",
        "label": "per_page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "pagination_token",
        "label": "pagination_token",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "posts-engagement-reactions",
    "group": "Posts",
    "label": "Get post reactions",
    "method": "POST",
    "path": "/posts/engagement/reactions",
    "summary": "Inbound engagement on a post - who reacted, filterable by reaction type.",
    "fields": [
      {
        "name": "urn",
        "label": "urn",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "7267273010393358336",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "share_urn",
        "label": "share_urn",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "page",
        "label": "page",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 1,
        "in": "body"
      },
      {
        "name": "per_page",
        "label": "per_page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "pagination_token",
        "label": "pagination_token",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      },
      {
        "name": "reaction_type",
        "label": "reaction_type",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "ALL",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "posts-engagement-reposts",
    "group": "Posts",
    "label": "Get post reposts",
    "method": "POST",
    "path": "/posts/engagement/reposts",
    "summary": "Inbound engagement on a post - who reposted it.",
    "fields": [
      {
        "name": "urn",
        "label": "urn",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "7267273010393358336",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "url",
        "label": "url",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "share_urn",
        "label": "share_urn",
        "required": false,
        "primary": true,
        "type": "text",
        "in": "body",
        "exclusiveGroup": "subject"
      },
      {
        "name": "page",
        "label": "page",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 1,
        "in": "body"
      },
      {
        "name": "per_page",
        "label": "per_page",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "body"
      },
      {
        "name": "pagination_token",
        "label": "pagination_token",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "search-people",
    "group": "Search",
    "label": "Search people",
    "method": "POST",
    "path": "/search/people",
    "summary": "Live people search with structured filters.",
    "fields": [
      {
        "name": "filters",
        "label": "filters",
        "required": true,
        "primary": true,
        "type": "json",
        "default": "{\n  \"titles\": [\n    \"CTO\"\n  ],\n  \"keywords\": \"kubernetes\"\n}",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 10,
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "search-people-sales-nav",
    "group": "Search",
    "label": "Search people (Sales Navigator)",
    "method": "POST",
    "path": "/search/people/sales-nav",
    "summary": "Search people with structured filters or a pasted Sales Navigator URL.",
    "fields": [
      {
        "name": "filters",
        "label": "filters",
        "required": false,
        "primary": true,
        "type": "json",
        "default": "{\n  \"titles\": [\n    \"VP Sales\"\n  ],\n  \"seniorities\": [\n    \"vp\",\n    \"director\"\n  ],\n  \"location_ids\": [\n    {\n      \"id\": \"102095887\",\n      \"text\": \"California\"\n    }\n  ],\n  \"company_sizes\": [\n    \"51-200\",\n    \"201-500\"\n  ]\n}",
        "in": "body"
      },
      {
        "name": "sales_nav_url",
        "label": "sales_nav_url",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 50,
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "search-people-standard",
    "group": "Search",
    "label": "Search people (standard)",
    "method": "POST",
    "path": "/search/people/standard",
    "summary": "People search on LinkedIn's regular search, not Sales Navigator.",
    "fields": [
      {
        "name": "filters",
        "label": "filters",
        "required": true,
        "primary": true,
        "type": "json",
        "default": "{\n  \"titles\": [\n    \"CTO\"\n  ],\n  \"keywords\": \"kubernetes\",\n  \"locations\": [\n    \"United States\"\n  ]\n}",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 25,
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "search-companies",
    "group": "Search",
    "label": "Search companies",
    "method": "POST",
    "path": "/search/companies",
    "summary": "Live company search with structured filters.",
    "fields": [
      {
        "name": "filters",
        "label": "filters",
        "required": true,
        "primary": true,
        "type": "json",
        "default": "{\n  \"industry_ids\": [\n    \"96\"\n  ],\n  \"company_sizes\": [\n    \"201-500\"\n  ]\n}",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 50,
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "search-companies-sales-nav",
    "group": "Search",
    "label": "Search companies (Sales Navigator)",
    "method": "POST",
    "path": "/search/companies/sales-nav",
    "summary": "Search companies with structured filters or a pasted Sales Navigator URL.",
    "fields": [
      {
        "name": "filters",
        "label": "filters",
        "required": false,
        "primary": true,
        "type": "json",
        "default": "{\n  \"industry_ids\": [\n    \"96\"\n  ],\n  \"company_sizes\": [\n    \"201-500\"\n  ]\n}",
        "in": "body"
      },
      {
        "name": "sales_nav_url",
        "label": "sales_nav_url",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 50,
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "search-companies-standard",
    "group": "Search",
    "label": "Search companies (standard)",
    "method": "POST",
    "path": "/search/companies/standard",
    "summary": "Company search on LinkedIn's regular search, not Sales Navigator.",
    "fields": [
      {
        "name": "filters",
        "label": "filters",
        "required": true,
        "primary": true,
        "type": "json",
        "default": "{\n  \"keywords\": \"fintech\",\n  \"company_sizes\": [\n    \"51-200\"\n  ],\n  \"industry_ids\": [\n    \"4\"\n  ]\n}",
        "in": "body"
      },
      {
        "name": "max_results",
        "label": "max_results",
        "required": false,
        "primary": true,
        "type": "number",
        "default": 25,
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "batch-create",
    "group": "Batch",
    "label": "Create a batch job",
    "method": "POST",
    "path": "/batch",
    "summary": "Submit up to 1,000 mixed enrich and search items as one asynchronous job.",
    "fields": [
      {
        "name": "Idempotency-Key",
        "label": "Idempotency-Key",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "header"
      },
      {
        "name": "items",
        "label": "items",
        "required": true,
        "primary": true,
        "type": "json",
        "default": "[\n  {\n    \"type\": \"profile\",\n    \"url\": \"https://linkedin.com/in/a\"\n  },\n  {\n    \"type\": \"profile\",\n    \"url\": \"https://linkedin.com/in/b\"\n  },\n  {\n    \"type\": \"company\",\n    \"url\": \"https://linkedin.com/company/acme\"\n  }\n]",
        "in": "body"
      },
      {
        "name": "webhook_url",
        "label": "webhook_url",
        "required": false,
        "primary": true,
        "type": "text",
        "default": "https://app.example.com/hooks/uptodata",
        "in": "body"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "batch-get",
    "group": "Batch",
    "label": "Get a batch job",
    "method": "GET",
    "path": "/batch/{job_id}",
    "summary": "Poll a batch job for its status and accumulated results, for free.",
    "fields": [
      {
        "name": "job_id",
        "label": "job_id",
        "required": true,
        "primary": true,
        "type": "text",
        "in": "path"
      }
    ]
  },
  {
    "takesNothing": false,
    "id": "batch-results",
    "group": "Batch",
    "label": "Get incremental batch result entries",
    "method": "GET",
    "path": "/batch/{job_id}/results",
    "summary": "Read a batch job's result entries as an incremental, cursor-paged feed.",
    "fields": [
      {
        "name": "job_id",
        "label": "job_id",
        "required": true,
        "primary": true,
        "type": "text",
        "in": "path"
      },
      {
        "name": "cursor",
        "label": "cursor",
        "required": false,
        "primary": false,
        "type": "text",
        "in": "query"
      },
      {
        "name": "limit",
        "label": "limit",
        "required": false,
        "primary": false,
        "type": "number",
        "in": "query"
      }
    ]
  },
  {
    "takesNothing": true,
    "id": "account-get",
    "group": "Account",
    "label": "Get account",
    "method": "GET",
    "path": "/account",
    "summary": "Balance, tier, monthly credit usage, and rate limits, for free.",
    "fields": []
  }
]

export const v1ById = (id) => V1_ENDPOINTS.find((e) => e.id === id) || null

export const V1_GROUPS = [...new Set(V1_ENDPOINTS.map((e) => e.group))]
