import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const degToRad = (deg) => deg * (Math.PI / 180);

export class Texture {
    constructor() {
        this.scene = new THREE.Scene();
        this.clock = new THREE.Clock();

        this.bookInstances = [];
        this.clickableObjects = [];

        this.finalPositions = [
            { x: -1.5, y: -0.2, z: 0.25 },
            { x: -0.5, y: -0.2, z: 0.25 },
            { x: 0.5, y: -0.2, z: 0.25 },
            { x: 1.5, y: -0.2, z: 0.25 },
        ];

        this.books = [
            { name: "The How", url: "/books/the-how-normal.glb" },
            { name: "Bone", url: "/books/bone-normal.glb" },
            { name: "The Terrible", url: "/books/the-terrible-normal.glb" },
            { name: "The Catch", url: "/books/the-catch-normal.glb" },
        ];

        this.scrollTrigger = null;
        this.isClosingFromScroll = false;
        this.bookClosePromise = null;
        this.lastCalculatedPositions = [];


        // 90% for full open, 20% for hover
        this.clickPlayPercentage = 0.9;
        this.hoverPlayPercentage = 0.2;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.currentHoveredIndex = -1;
        this.canInteract = false;

        this.init();
    }

    init() {
        this.setUpSizes();
        this.initCamera();
        this.initLights();
        this.createRenderer();
        this.addResizeListener();

        this.loadBooks();
    }

    setUpSizes() {
        this.sizes = {
            width: window.innerWidth,
            height: window.innerHeight,
        };
        this.aspectRatio = this.sizes.width / this.sizes.height;
    }

    loadBooks() {
        this.gltfLoader = new GLTFLoader();
        this.bookInstances = new Array(this.books.length).fill(null);
        let loadedCount = 0;

        this.books.forEach((bookData, index) => {
            this.gltfLoader.load(
                bookData.url,
                (gltf) => {
                    const bookScene = gltf.scene;
                    bookScene.scale.set(2, 2, 2);

                    // Position initially
                    const { x, y, z } = this.finalPositions[index];
                    bookScene.position.set(x, y, z);

                    bookScene.userData.bookIndex = index;

                    const mixer = new THREE.AnimationMixer(bookScene);

                    const bookInstance = {
                        scene: bookScene,
                        mixer,
                        name: bookData.name,
                        index,
                        animationActions: [],
                        isOpen: false,
                        isClickPlaying: false,
                        isHoverPlaying: false,

                        originalPosition: { x, y, z },
                        originalRotation: {
                            x: bookScene.rotation.x,
                            y: bookScene.rotation.y,
                            z: bookScene.rotation.z,
                        },

                        openTimeline: null,
                        closeTimeline: null,
                    };

                    this.scene.add(bookScene);
                    this.bookInstances[index] = bookInstance;

                    // Make each Mesh in the GLTF clickable
                    bookScene.traverse((child) => {
                        if (child.isMesh) {
                            child.userData.bookIndex = index;
                            child.userData.bookName = bookData.name;
                            this.clickableObjects.push(child);
                        }
                    });

                    if (gltf.animations?.length) {
                        gltf.animations.forEach((clip) => {
                            const action = mixer.clipAction(clip);
                            action.clampWhenFinished = true;
                            action.setLoop(THREE.LoopOnce);
                            bookInstance.animationActions.push({
                                action,
                                originalDuration: clip.duration,
                            });
                        });
                    }

                    loadedCount++;
                    if (loadedCount === this.books.length) {
                        this.onAllBooksLoaded();
                    }
                },
                undefined,
                (error) => {
                    console.error(`Error loading ${bookData.name}:`, error);
                    loadedCount++;
                    if (loadedCount === this.books.length) {
                        this.onAllBooksLoaded();
                    }
                },
            );
        });
    }

    onAllBooksLoaded() {
        this.addClickListener();
        this.addHoverListeners();
        this.animate();
        this.animateBookEntry();
    }

    initLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);
    }

    initCamera() {
        this.camera = new THREE.PerspectiveCamera(75, this.aspectRatio, 0.1, 100);
        this.camera.position.z = 1;
        this.scene.add(this.camera);
    }

    createRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
        });
        this.renderer.setSize(this.sizes.width, this.sizes.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        document
            .querySelector(".pinned-section")
            .appendChild(this.renderer.domElement);
    }

    // MAIN SCROLLTRIGGER + AUTO-CLOSE LOGIC
    // Update the onUpdate handler in animateBookEntry to include smooth scroll transition
    animateBookEntry() {
        this.camera.position.x = 1;
        let lastProgress = 0;

        this.scrollTrigger = ScrollTrigger.create({
            trigger: ".pinned-section",
            start: "top top",
            end: "+=300%",
            pin: true,
            scrub: 1,
            markers: true,

            onLeaveBack: () => {
                // If the user fully scrolls back to top, close all
                this.closeAllOpenBooks();
            },

            onUpdate: (self) => {
                // If user scrolls UP (progress < lastProgress) and any book is open
                if (self.progress < lastProgress && this.isAnyBookOpen() && !this.isClosingFromScroll) {
                    // Store the target progress we want to animate to
                    const targetProgress = self.progress;

                    // Pause the ScrollTrigger temporarily
                    self.disable();

                    // Set flag to prevent recursive calls
                    this.isClosingFromScroll = true;

                    // Close all books with a promise
                    this.closeAllOpenBooksWithPromise().then(() => {
                        // After closing books, we want to smoothly transition
                        // to the appropriate scroll position
                        self.enable();

                        // Calculate where each book should be in the elliptical path
                        // based on the current scroll progress
                        const targetBookPositions = this.calculateBookPositionsForProgress(targetProgress);

                        // First, animate the books to their correct positions
                        const positionTransition = gsap.timeline({
                            onComplete: () => {
                                // Now smoothly animate the scroll position over 2 seconds (3x slower)
                                // Store the current scroll position
                                const startScrollY = window.scrollY;
                                // Calculate the scroll position that corresponds to the target progress
                                // We need to convert ScrollTrigger progress to actual scroll position
                                const totalScrollDistance = self.end - self.start;
                                const endScrollY = self.start + (totalScrollDistance * targetProgress);
                                const scrollDistance = endScrollY - startScrollY;

                                // Create a manual scroll animation
                                gsap.to({progress: 0}, {
                                    progress: 1,
                                    duration: 2, // 3x slower than typical
                                    ease: "power2.inOut",
                                    onUpdate: function() {
                                        // Calculate the current scroll position based on progress
                                        const currentY = startScrollY + (scrollDistance * this.progress);
                                        window.scrollTo(0, currentY);
                                    },
                                    onComplete: () => {
                                        // Make sure we end exactly at the target position
                                        window.scrollTo(0, endScrollY);
                                        // Reset the flag after all animations are complete
                                        this.isClosingFromScroll = false;
                                    }
                                });
                            }
                        });

                        // Animate each book to its calculated position
                        this.bookInstances.forEach((book, index) => {
                            if (!book) return;

                            const targetPos = targetBookPositions[index];
                            positionTransition.to(book.scene.position, {
                                duration: 0.75, // Slightly longer for smoother transition
                                x: targetPos.x,
                                y: targetPos.y,
                                z: book.scene.position.z,
                                ease: "power2.out"
                            }, 0);

                            // Also animate rotation
                            const targetRotation = {
                                x: targetProgress * degToRad(90),
                                y: 0,
                                z: targetProgress * degToRad(-28 - index * 20)
                            };

                            positionTransition.to(book.scene.rotation, {
                                duration: 0.75,
                                x: targetRotation.x,
                                y: targetRotation.y,
                                z: targetRotation.z,
                                ease: "power2.out"
                            }, 0);
                        });
                    });
                }

                // Only update positions if we're not in the middle of a scroll-triggered close
                if (!this.isClosingFromScroll) {
                    // Update book positions based on scroll
                    this.updateBookPositions(self.progress);

                    // Only allow interaction if fully scrolled to the bottom
                    this.canInteract = (self.progress === 1);
                }

                lastProgress = self.progress;
            },
        });
    }

// New method that returns a Promise for when all books are closed
    closeAllOpenBooksWithPromise() {
        // If we already have a promise in progress, return it
        if (this.bookClosePromise) return this.bookClosePromise;

        // If no books are open, resolve immediately
        if (!this.isAnyBookOpen()) {
            return Promise.resolve();
        }

        // Create a new promise
        this.bookClosePromise = new Promise((resolve) => {
            // Keep track of which books need to close
            const openBookIndices = this.bookInstances
                .filter(book => book && book.isOpen)
                .map(book => book.index);

            if (openBookIndices.length === 0) {
                this.bookClosePromise = null;
                resolve();
                return;
            }

            // Track how many have finished closing
            let closedCount = 0;

            // Set up a completion check function
            const checkAllClosed = () => {
                closedCount++;
                if (closedCount >= openBookIndices.length) {
                    this.bookClosePromise = null;
                    resolve();
                }
            };

            // Close each book with a callback
            openBookIndices.forEach(index => {
                this.toggleBookAnimationWithCallback(index, checkAllClosed);
            });
        });

        return this.bookClosePromise;
    }



    // Helper: check if any book is currently open
    isAnyBookOpen() {
        return this.bookInstances.some((b) => b?.isOpen);
    }

    updateBookPositions(progress) {
        const ellipseConfigs = [
            { centerX: 0, centerY: 0, radiusX: 1.3, radiusY: 0.7 },
            { centerX: 0, centerY: 0, radiusX: 1.1, radiusY: 0.5 },
            { centerX: 0, centerY: 0, radiusX: 0.9, radiusY: 0.4 },
            { centerX: 0, centerY: 0, radiusX: 0.7, radiusY: 0.3 },
        ];

        const angleConfigs = [
            {
                start: -Math.PI * 1.0,
                endX: -Math.PI * 2.2,
                endY: -Math.PI * 2.14,
            },
            {
                start: -Math.PI * 1.2,
                endX: -Math.PI * 2.35,
                endY: -Math.PI * 2.2,
            },
            {
                start: -Math.PI * 1.4,
                endX: -Math.PI * 2.5,
                endY: -Math.PI * 2.265,
            },
            {
                start: -Math.PI * 1.6,
                endX: -Math.PI * 2.8,
                endY: -Math.PI * 2.45,
            },
        ];

        this.camera.position.x = 1.4 - progress;

        this.bookInstances.forEach((book, i) => {
            if (!book) return;

            const { start, endX, endY } = angleConfigs[i];
            const { centerX, centerY, radiusX, radiusY } = ellipseConfigs[i];
            const angleX = start + (endX - start) * progress;
            const angleY = start + (endY - start) * progress;

            const x = centerX + radiusX * Math.cos(angleX);
            const y = centerY + radiusY * Math.sin(angleY);

            // If not open or actively clicking, let the ellipse drive the position
            if (!book.isOpen && !book.isClickPlaying) {
                book.scene.position.set(x, y, book.scene.position.z);
                book.scene.rotation.set(
                    progress * degToRad(90),
                    0,
                    progress * degToRad(-28 - i * 20),
                );
            }
        });
    }

    closeAllOpenBooks() {
        return this.closeAllOpenBooksWithPromise();
    }

    animate() {
        const deltaTime = this.clock.getDelta();
        this.bookInstances.forEach((book) => {
            if (book && (book.isClickPlaying || book.isHoverPlaying)) {
                book.mixer.update(deltaTime);
                this.checkAnimationProgress(book);
            }
        });

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(() => this.animate());
    }

    checkAnimationProgress(book) {
        book.animationActions.forEach((animObj) => {
            const { action, originalDuration } = animObj;
            const currentTime = action.time;

            // If it's a click animation:
            if (book.isClickPlaying) {
                const forwardLimit =
                    originalDuration * this.clickPlayPercentage; // 90%
                const reverseLimit = 0;

                // Opening forward
                if (action.timeScale > 0 && currentTime >= forwardLimit) {
                    action.paused = true;
                    action.time = forwardLimit;
                    book.isClickPlaying = false;
                    book.isOpen = true; // Reached 90% => open
                }
                // Closing backward
                else if (action.timeScale < 0 && currentTime <= reverseLimit) {
                    action.paused = true;
                    action.time = reverseLimit;
                    book.isClickPlaying = false;
                    book.isOpen = false; // Reached 0% => closed
                }
            }

            // If it's a hover animation:
            if (book.isHoverPlaying) {
                const hoverForwardLimit =
                    originalDuration * this.hoverPlayPercentage; // 20%
                const hoverReverseLimit = 0;

                // Hover forward (0->20%)
                if (action.timeScale > 0 && currentTime >= hoverForwardLimit) {
                    action.paused = true;
                    action.time = hoverForwardLimit;
                    book.isHoverPlaying = false;
                }
                // Hover backward (20%->0)
                else if (action.timeScale < 0 && currentTime <= hoverReverseLimit) {
                    action.paused = true;
                    action.time = hoverReverseLimit;
                    book.isHoverPlaying = false;
                }
            }
        });
    }

    // Extract the ellipse calculation logic to a separate method so we can reuse it
    calculateBookPositionsForProgress(progress) {
        const ellipseConfigs = [
            { centerX: 0, centerY: 0, radiusX: 1.3, radiusY: 0.7 },
            { centerX: 0, centerY: 0, radiusX: 1.1, radiusY: 0.5 },
            { centerX: 0, centerY: 0, radiusX: 0.9, radiusY: 0.4 },
            { centerX: 0, centerY: 0, radiusX: 0.7, radiusY: 0.3 },
        ];

        const angleConfigs = [
            {
                start: -Math.PI * 1.0,
                endX: -Math.PI * 2.2,
                endY: -Math.PI * 2.14,
            },
            {
                start: -Math.PI * 1.2,
                endX: -Math.PI * 2.35,
                endY: -Math.PI * 2.2,
            },
            {
                start: -Math.PI * 1.4,
                endX: -Math.PI * 2.5,
                endY: -Math.PI * 2.265,
            },
            {
                start: -Math.PI * 1.6,
                endX: -Math.PI * 2.8,
                endY: -Math.PI * 2.45,
            },
        ];

        const positions = [];

        // Calculate position for each book
        for (let i = 0; i < this.books.length; i++) {
            const { start, endX, endY } = angleConfigs[i];
            const { centerX, centerY, radiusX, radiusY } = ellipseConfigs[i];
            const angleX = start + (endX - start) * progress;
            const angleY = start + (endY - start) * progress;

            const x = centerX + radiusX * Math.cos(angleX);
            const y = centerY + radiusY * Math.sin(angleY);

            positions.push({ x, y });
        }

        // Store these positions for potential later use
        this.lastCalculatedPositions = positions;

        return positions;
    }


    /**
     * The main open/close logic
     */
    toggleBookAnimationWithCallback(bookIndex, callback) {
        const book = this.bookInstances[bookIndex];
        if (!book || !book.animationActions.length) {
            if (callback) callback();
            return;
        }

        // Cancel any hover in progress
        if (book.isHoverPlaying) {
            book.isHoverPlaying = false;
            book.animationActions.forEach((animObj) => {
                animObj.action.paused = true;
            });
        }

        // Build the "open" timeline once
        if (!book.openTimeline) {
            // Your existing openTimeline creation code
            book.openTimeline = gsap.timeline({
                onComplete: () => {
                    book.openTimeline.pause();
                    book.openTimeline.progress(1);
                },
                onReverseComplete: () => {
                    book.openTimeline.pause();
                    book.openTimeline.progress(0);
                    if (callback) callback();
                },
            });

            // Add your existing animations to the timeline
            book.openTimeline.to(
                book.scene.rotation,
                {
                    duration: 0.5,
                    z: 0,
                },
                0
            );

            book.openTimeline.to(
                book.scene.position,
                {
                    duration: 2,
                    x: 0.4,
                    y: 0,
                    z: 0.5,
                },
                "<"
            );

            this.bookInstances.forEach((other, i) => {
                if (!other || i === bookIndex) return;
                const offscreenX = i < bookIndex ? 5 : -5;
                book.openTimeline.to(
                    other.scene.position,
                    {
                        duration: 3,
                        x: offscreenX,
                    },
                    0
                );
            });

            book.openTimeline.pause(0);
        }

        // Open or close?
        if (!book.isOpen) {
            // Opening => run forward page-turn
            book.isClickPlaying = true;
            book.animationActions.forEach((animObj) => {
                const { action } = animObj;
                action.paused = false;
                action.timeScale = 1;
                action.play();
            });

            // Make sure timeline is at start, then play forward
            book.openTimeline.timeScale(1);
            book.openTimeline.progress(0);
            book.openTimeline.play();
        } else {
            // Closing => run backward page-turn
            book.isClickPlaying = true;
            book.animationActions.forEach((animObj) => {
                const { action } = animObj;
                action.paused = false;
                action.timeScale = -1;
                action.play();
            });

            // Modify the existing animation completion check to use the callback
            if (book.animationActions.length > 0) {
                const firstAction = book.animationActions[0].action;
                const originalCheckAnimationProgress = this.checkAnimationProgress.bind(this);

                // Replace with custom check that includes callback
                this.checkAnimationProgress = function(checkBook) {
                    originalCheckAnimationProgress(checkBook);

                    // If this is our book and it's done closing
                    if (checkBook === book && !book.isClickPlaying && !book.isOpen) {
                        // Restore original function
                        this.checkAnimationProgress = originalCheckAnimationProgress;

                        // Call the callback
                        if (callback) callback();
                    }
                };
            }

            // Reverse the timeline
            book.openTimeline.timeScale(2); // speed up the reverse
            book.openTimeline.progress(1);
            book.openTimeline.reverse();
        }
    }


    // Only allow clicks if we can interact
    onCanvasClick(event) {
        if (!this.canInteract || this.isClosingFromScroll) return;

        this.mouse.x = (event.clientX / this.sizes.width) * 2 - 1;
        this.mouse.y = -((event.clientY / this.sizes.height) * 2 - 1);

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.clickableObjects);

        if (intersects.length) {
            const { bookIndex, bookName } = intersects[0].object.userData;
            if (bookIndex !== undefined) {
                console.log(`Clicked Book ${bookIndex} (${bookName})`);

                // Use the new method, but without a callback for regular clicks
                this.toggleBookAnimationWithCallback(bookIndex, null);

                // If we're opening a book and other books are open, close them
                const book = this.bookInstances[bookIndex];
                if (book && !book.isOpen) {
                    this.bookInstances.forEach((otherBook, i) => {
                        if (otherBook && i !== bookIndex && otherBook.isOpen) {
                            this.toggleBookAnimationWithCallback(i, null);
                        }
                    });
                }
            }
        }
    }

    animateToFraction(book, fraction) {
        if (!book.animationActions.length) return;
        book.isHoverPlaying = true;

        book.animationActions.forEach((animObj) => {
            const { action, originalDuration } = animObj;
            const currentTime = action.time;
            const targetTime = fraction * originalDuration;

            const direction = currentTime < targetTime ? 1 : -1;
            action.timeScale = direction;
            action.paused = false;
            action.play();
        });
    }

    addHoverListeners() {
        this.renderer.domElement.addEventListener("mousemove", (event) =>
            this.onCanvasMouseMove(event),
        );
        this.renderer.domElement.addEventListener("mouseleave", () => {
            this.clearHoveredBook();
        });
    }

    onCanvasMouseMove(event) {
        if (!this.canInteract) return;

        this.mouse.x = (event.clientX / this.sizes.width) * 2 - 1;
        this.mouse.y = -((event.clientY / this.sizes.height) * 2 - 1);

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.clickableObjects);

        if (intersects.length) {
            const { bookIndex } = intersects[0].object.userData;
            if (bookIndex === this.currentHoveredIndex) return;

            this.clearHoveredBook();
            this.setHoveredBook(bookIndex);
        } else {
            this.clearHoveredBook();
        }
    }

    setHoveredBook(bookIndex) {
        this.currentHoveredIndex = bookIndex;
        const book = this.bookInstances[bookIndex];
        if (!book) return;

        // If book is open or is opening/closing, skip hover
        if (book.isOpen || book.isClickPlaying) return;

        this.animateToFraction(book, this.hoverPlayPercentage);
    }

    clearHoveredBook() {
        if (this.currentHoveredIndex === -1) return;
        const oldBook = this.bookInstances[this.currentHoveredIndex];
        this.currentHoveredIndex = -1;
        if (!oldBook) return;

        if (oldBook.isOpen || oldBook.isClickPlaying) return;
        this.animateToFraction(oldBook, 0);
    }

    addResizeListener() {
        window.addEventListener("resize", () => {
            this.sizes.width = window.innerWidth;
            this.sizes.height = window.innerHeight;
            this.aspectRatio = this.sizes.width / this.sizes.height;

            this.camera.aspect = this.aspectRatio;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.sizes.width, this.sizes.height);
        });
    }

    addClickListener() {
        this.renderer.domElement.addEventListener("click", (event) =>
            this.onCanvasClick(event),
        );
    }
}

// Create the texture instance
new Texture();
