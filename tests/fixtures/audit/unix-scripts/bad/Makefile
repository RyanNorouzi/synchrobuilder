.PHONY: build clean

CC := gcc

build:
	@node build.mjs $(FLAGS)

clean:
	rm -rf dist
	mkdir -p dist && touch dist/.keep

release: build
	node release.mjs | tee release.log
