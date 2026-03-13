I will use SvelteKit/Netlify for hosting the site

I will use Supabase for:
    - connection to BookDoc API (local server providing recommendations)
    - saving user ratings
    - saving user pinned books
    - saving user recommendation list
    - signup/login (including guest anonymous login)

I will use BookDoc API:
    - generating recommendations for the reader

I will use Google Books API:
    - for book search function
    - to get book metadada (cover urls, title, ISBN, author, short summary)


Objects:
Books: title, author, year, cover image url, short summary
Reader: Nickname, email, password, book ratings, pinned books (to read)




I now wish to set up the book search and popular books list functionality using Google Book API 

A few details:
- I want to get book covers, titles and authors
- I want to show the search results instead of the popular books when users start typing 
- I want to get just one book per edition (so there are no. repeat books)
- I want to show an initial popular book list (30 books to start) so users can easily start rating, this list should support lazy loading - if user scrolls additional books should appear, this should be based on relevance. Later this functionality will likely be suported by Book Doctor API, but I want to first set it up with Google Books API. 
