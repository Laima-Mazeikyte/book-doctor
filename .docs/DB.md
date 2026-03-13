I will use SvelteKit/Netlify for hosting the site

I will use Supabase for:
    - connection/webhook to BookDoc API (local server providing recommendations)
    - saving user ratings
    - saving user pinned books
    - saving user recommendation list
    - signup/login (including guest anonymous login)
    - book metada storage (cover url, title, ISBN, author, short summary)

I will use BookDoc API:
    - generating recommendations for the reader
    - generatung a book suggestion list for ratings (Active Recommender Loop)

I will use Bunny.net:
    - to store book images

Objects:
Books: title, author, year, cover image url, short summary
Reader: Nickname, email, password, book ratings, pinned books (to read)

