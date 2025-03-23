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

        // 90% for full open, 20% for hover, etc.
        this.clickPlayPercentage = 0.9;
        this.hoverPlayPercentage = 0.2;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Track hovered book index
        this.currentHoveredIndex = -1;

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

                        // Store original transform
                        originalPosition: { x, y, z },
                        originalRotation: {
                            x: bookScene.rotation.x,
                            y: bookScene.rotation.y,
                            z: bookScene.rotation.z,
                        },

                        openTimeline: null, // We'll build this once the user clicks
                        closeTimeline: null,
                    };

                    this.scene.add(bookScene);
                    this.bookInstances[index] = bookInstance;

                    bookScene.traverse((child) => {
                        if (child.isMesh) {
                            child.userData.bookIndex = index;
                            child.userData.bookName = bookData.name;
                            this.clickableObjects.push(child);
                        }
                    });

                    mixer.addEventListener("finished", () => {
                        // We'll rely on checkAnimationProgress for finishing logic
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

    animateBookEntry() {
        this.camera.position.x = 1;

        // Use a variable so we can check direction if we want
        let lastProgress = 0;

        ScrollTrigger.create({
            trigger: ".pinned-section",
            start: "top top",
            end: "+=300%",
            pin: true,
            scrub: 1,
            markers: true,

            // If you want to auto-close on reversing scroll,
            // use onUpdate below. If you'd rather wait until the
            // user scrolls all the way back, use onLeaveBack instead.
            /*
            onUpdate: (self) => {
              // Example of auto close if direction < 0
              if (self.progress < lastProgress) {
                // User is scrolling up
                this.closeAllOpenBooks();
              }
              lastProgress = self.progress;
              // Keep your existing ellipse code:
              this.updateBookPositions(self.progress);
            },
            */

            onLeaveBack: () => {
                // Called once the user scrolls all the way to the top
                this.closeAllOpenBooks();
            },

            onUpdate: (self) => {
                // Keep your existing ellipse code:
                this.updateBookPositions(self.progress);
            },
        });
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

        // Move each book in an ellipse
        this.bookInstances.forEach((book, i) => {
            if (!book) return;

            const { start, endX, endY } = angleConfigs[i];
            const { centerX, centerY, radiusX, radiusY } = ellipseConfigs[i];
            const angleX = start + (endX - start) * progress;
            const angleY = start + (endY - start) * progress;

            const x = centerX + radiusX * Math.cos(angleX);
            const y = centerY + radiusY * Math.sin(angleY);

            // Only move if it's closed. If it's open, we presumably want
            // the timeline’s position to dominate. But you can remove this
            // condition if you DO want the scroll to override the open state:
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
        this.bookInstances.forEach((book) => {
            if (book && book.isOpen) {
                this.toggleBookAnimation(book.index);
            }
        });
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
                const forwardLimit = originalDuration * this.clickPlayPercentage; // 90%
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
                const hoverForwardLimit = originalDuration * this.hoverPlayPercentage; // 20%
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

    /**
     * The main click handler: open or close the book, *and* run a GSAP timeline
     * to move the clicked book to the center and push others off-screen if opening.
     */
    toggleBookAnimation(bookIndex) {
        const book = this.bookInstances[bookIndex];
        if (!book || !book.animationActions.length) return;

        // Cancel any hover animation in progress
        if (book.isHoverPlaying) {
            book.isHoverPlaying = false;
            book.animationActions.forEach((animObj) => {
                animObj.action.paused = true;
            });
        }

        // If we haven't created the timeline yet, create it once.
        // We add onComplete and onReverseComplete to ensure it “snaps”
        // to fully open or fully closed states at the end.
        if (!book.openTimeline) {
            book.openTimeline = gsap.timeline({
                onComplete: () => {
                    // Snap to the end so reversing is consistent
                    book.openTimeline.pause();
                    book.openTimeline.progress(1);
                },
                onReverseComplete: () => {
                    // Snap to the start
                    book.openTimeline.pause();
                    book.openTimeline.progress(0);
                },
            });

            // Build the "open" animation
            // 1) Rotate book z to 0
            book.openTimeline.to(
                book.scene.rotation,
                {
                    duration: 0.5,
                    z: 0,
                },
                0,
            );

            // 2) Move the clicked book to center
            book.openTimeline.to(
                book.scene.position,
                {
                    duration: 2,
                    x: 0.4,
                    y: 0,
                    z: 0.5,
                },
                "<",
            );

            // 3) Move other books off-screen
            this.bookInstances.forEach((other, i) => {
                if (!other || i === bookIndex) return;
                const offscreenX = i < bookIndex ? 5 : -5;
                book.openTimeline.to(
                    other.scene.position,
                    {
                        duration: 3,
                        x: offscreenX,
                    },
                    0,
                );
            });

            // Initially pause at start
            book.openTimeline.pause(0);
        }

        // Are we opening or closing?
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
            // Jump to 0 (just in case it’s partially done)
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

            // Reverse the timeline
            book.openTimeline.timeScale(2); // speed up the reverse
            // Ensure we start from the fully open end
            book.openTimeline.progress(1);
            book.openTimeline.reverse();
        }
    }

    onCanvasClick(event) {
        this.mouse.x = (event.clientX / this.sizes.width) * 2 - 1;
        this.mouse.y = -((event.clientY / this.sizes.height) * 2 - 1);

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.clickableObjects);

        if (intersects.length) {
            const { bookIndex, bookName } = intersects[0].object.userData;
            if (bookIndex !== undefined) {
                console.log(`Clicked Book ${bookIndex} (${bookName})`);
                this.toggleBookAnimation(bookIndex);
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
